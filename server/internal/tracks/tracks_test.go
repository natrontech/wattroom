package tracks

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/natrontech/wattroom/server/internal/audio/audiotest"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

type fakeUsers struct{ byToken map[string]db.User }

func (f *fakeUsers) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	if !ok {
		http.Error(w, `{"error":"unauthorized","message":"`+signInMessage+`"}`, http.StatusUnauthorized)
	}
	return u, ok
}

type harness struct {
	mux   *http.ServeMux
	users *fakeUsers
	store *store.Store
	dir   string
}

func setup(t *testing.T) *harness {
	t.Helper()
	st := storetest.Open(t)

	users := &fakeUsers{byToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
			DisplayName: name, FtpWatts: 200, WeightKg: 75,
		})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.byToken[name] = u
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
	}
	// A directory per test: the pool is content-addressed, so two tests using
	// the same bytes would otherwise share a file and one would delete it out
	// from under the other.
	dir := t.TempDir()
	mux := http.NewServeMux()
	svc := &Service{store: st, auth: users, log: slog.New(slog.DiscardHandler), dir: dir}
	svc.Register(mux)
	return &harness{mux: mux, users: users, store: st, dir: dir}
}

func (h *harness) do(t *testing.T, who, method, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, bytes.NewReader(body))
	if who != "" {
		req.Header.Set("X-Test-User", who)
	}
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	return w
}

func decode(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %s: %v", w.Body.String(), err)
	}
	return out
}

// song is a real MP3 of `frames` frames, unique per `seed` so two tests do not
// collide on one content address.
func song(seed byte, frames int) []byte {
	return append(audiotest.MP3(frames, 9, 0), seed)
}

func (h *harness) upload(t *testing.T, who string, data []byte, name string) map[string]any {
	t.Helper()
	w := h.do(t, who, http.MethodPost, "/api/tracks?name="+url.QueryEscape(name), data)
	if w.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", w.Code, w.Body.String())
	}
	body := decode(t, w)
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(context.Background(), "delete from tracks where id = $1", body["id"])
	})
	return body
}

func TestUploadMeasuresTheFileAndStoresItByContent(t *testing.T) {
	h := setup(t)
	data := song(1, 383) // ~10 s at 128 kbps
	body := h.upload(t, "alice", data, "Midnight City.mp3")

	// The duration is walked out of the frames, not taken from the uploader.
	if ms, _ := body["durationMs"].(float64); ms < 9500 || ms > 10500 {
		t.Errorf("durationMs = %v, want ~10004 measured from the frames", body["durationMs"])
	}
	// No ID3 tag on a synthetic file, so the filename is the fallback title.
	if body["title"] != "Midnight City" {
		t.Errorf("title = %v, want the filename without its extension", body["title"])
	}
	if body["uploadedBy"] != "alice" {
		t.Errorf("uploadedBy = %v", body["uploadedBy"])
	}

	// The file is on disk at its content address, fanned out by two hex chars.
	sha := Address(data)
	path := filepath.Join(h.dir, sha[:2], sha+".mp3")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stored file: %v", err)
	}
	if info.Size() != int64(len(data)) {
		t.Errorf("stored %d bytes, uploaded %d", info.Size(), len(data))
	}
}

func TestUploadRefusesWhatIsNotAnMp3(t *testing.T) {
	h := setup(t)
	w := h.do(t, "alice", http.MethodPost, "/api/tracks?name=x.mp3", []byte("PNG, honestly"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if body := decode(t, w); body["error"] != "validation_error" {
		t.Errorf("error = %v, want validation_error", body["error"])
	}
}

// Since #1095 a shelf is per uploader, so two riders holding one song is two
// rows over ONE file. This replaces the old "a duplicate makes no second
// track", which was true only while the pool was one shared library.
func TestTwoRidersHoldingOneSongShareTheFileNotTheRow(t *testing.T) {
	h := setup(t)
	data := song(2, 383)
	first := h.upload(t, "alice", data, "Shared.mp3")

	// Bob uploads the same bytes and gets a row of HIS OWN. Handing back
	// alice's row would leave his own upload missing from his shelf.
	w := h.do(t, "bob", http.MethodPost, "/api/tracks?name=Shared.mp3", data)
	if w.Code != http.StatusCreated {
		t.Fatalf("duplicate upload: %d %s", w.Code, w.Body.String())
	}
	bobs := decode(t, w)
	if bobs["id"] == first["id"] {
		t.Fatal("bob was handed alice's row")
	}
	if bobs["uploadedBy"] != "bob" {
		t.Errorf("uploadedBy = %v, want bob", bobs["uploadedBy"])
	}

	// One blob on disk, not two: privacy is what you can see, not how many
	// times the bytes are stored.
	sha := Address(data)
	entries, err := os.ReadDir(filepath.Join(h.dir, sha[:2]))
	if err != nil {
		t.Fatalf("read store: %v", err)
	}
	if len(entries) != 1 {
		t.Errorf("%d files stored for one sha, want 1", len(entries))
	}

	// And bob IS charged now — a shelf costs what it holds. This is the
	// change ADR-0015's "charges nobody" comment no longer describes.
	used, err := h.store.Queries.TrackQuotaUsed(t.Context(), h.users.byToken["bob"].ID)
	if err != nil {
		t.Fatalf("quota: %v", err)
	}
	if used != int64(len(data)) {
		t.Errorf("bob's quota = %d, want %d — his shelf holds it", used, len(data))
	}
}

// The same rider uploading their own song again still gets the row they
// already have, and no second one.
func TestAnUploaderReUploadingTheirOwnSongGetsTheSameRow(t *testing.T) {
	h := setup(t)
	data := song(11, 383)
	first := h.upload(t, "alice", data, "MineAgain.mp3")

	w := h.do(t, "alice", http.MethodPost, "/api/tracks?name=MineAgain.mp3", data)
	if w.Code != http.StatusOK {
		t.Fatalf("re-upload: %d %s", w.Code, w.Body.String())
	}
	if decode(t, w)["id"] != first["id"] {
		t.Errorf("a rider's own duplicate made a second row")
	}
}

func TestAudioIsSignedInOnlyAndSeekable(t *testing.T) {
	h := setup(t)
	data := song(3, 383)
	track := h.upload(t, "alice", data, "Ranged.mp3")
	id, _ := track["id"].(string)
	path := "/api/tracks/" + id + "/audio"

	if w := h.do(t, "", http.MethodGet, path, nil); w.Code != http.StatusUnauthorized {
		t.Errorf("signed out = %d, want 401", w.Code)
	}
	// #1095: another rider's shelf is ABSENT, not forbidden — answering 403
	// would confirm to a stranger that the id names a real track.
	if w := h.do(t, "bob", http.MethodGet, path, nil); w.Code != http.StatusNotFound {
		t.Errorf("bob played alice's track: %d, want 404", w.Code)
	}
	w := h.do(t, "alice", http.MethodGet, path, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("play = %d", w.Code)
	}
	if got := w.Body.Len(); got != len(data) {
		t.Errorf("served %d bytes, stored %d", got, len(data))
	}
	if ct := w.Header().Get("Content-Type"); ct != "audio/mpeg" {
		t.Errorf("content-type = %q", ct)
	}
	// Range requests are the reason the audio is a file rather than a column.
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	req.Header.Set("X-Test-User", "alice")
	req.Header.Set("Range", "bytes=0-99")
	ranged := httptest.NewRecorder()
	h.mux.ServeHTTP(ranged, req)
	if ranged.Code != http.StatusPartialContent {
		t.Errorf("ranged = %d, want 206", ranged.Code)
	}
	if ranged.Body.Len() != 100 {
		t.Errorf("ranged body = %d bytes, want 100", ranged.Body.Len())
	}
}

func TestOnlyTheUploaderEditsOrDeletes(t *testing.T) {
	h := setup(t)
	data := song(4, 383)
	track := h.upload(t, "alice", data, "Mine.mp3")
	id, _ := track["id"].(string)

	edit := []byte(`{"title":"Renamed","artist":"Someone","album":"","bpm":128}`)
	// 404 rather than the old 403 (#1095): alice's track is not bob's to be
	// refused, it is not his to know about.
	if w := h.do(t, "bob", http.MethodPatch, "/api/tracks/"+id, edit); w.Code != http.StatusNotFound {
		t.Errorf("bob edited alice's track: %d, want 404", w.Code)
	}
	if w := h.do(t, "bob", http.MethodDelete, "/api/tracks/"+id, nil); w.Code != http.StatusNotFound {
		t.Errorf("bob deleted alice's track: %d, want 404", w.Code)
	}

	w := h.do(t, "alice", http.MethodPatch, "/api/tracks/"+id, edit)
	if w.Code != http.StatusOK {
		t.Fatalf("alice's own edit: %d %s", w.Code, w.Body.String())
	}
	body := decode(t, w)
	if body["title"] != "Renamed" || body["bpm"] != float64(128) {
		t.Errorf("edit did not take: %v", body)
	}

	if w := h.do(t, "alice", http.MethodDelete, "/api/tracks/"+id, nil); w.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", w.Code)
	}
	// The row and the file both go.
	if w := h.do(t, "alice", http.MethodGet, "/api/tracks/"+id+"/audio", nil); w.Code != http.StatusNotFound {
		t.Errorf("deleted track still plays: %d", w.Code)
	}
	sha := Address(data)
	if _, err := os.Stat(filepath.Join(h.dir, sha[:2], sha+".mp3")); !os.IsNotExist(err) {
		t.Errorf("the file outlived its row")
	}
}

func TestEditValidatesAtTheBoundary(t *testing.T) {
	h := setup(t)
	track := h.upload(t, "alice", song(5, 383), "Bounds.mp3")
	id, _ := track["id"].(string)

	for _, tc := range []struct{ name, body string }{
		{"no title", `{"title":"   ","artist":"","album":"","bpm":null}`},
		{"impossible bpm", `{"title":"Fine","artist":"","album":"","bpm":900}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := h.do(t, "alice", http.MethodPatch, "/api/tracks/"+id, []byte(tc.body))
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", w.Code)
			}
			if decode(t, w)["error"] != "validation_error" {
				t.Errorf("error = %v", decode(t, w)["error"])
			}
		})
	}
}

func TestMissingTrackIs404AndSignedOutIs401(t *testing.T) {
	h := setup(t)
	gone := "/api/tracks/00000000-0000-0000-0000-000000000000"
	for _, tc := range []struct {
		name, who, method, path string
		want                    int
	}{
		{"list signed out", "", http.MethodGet, "/api/tracks", http.StatusUnauthorized},
		{"upload signed out", "", http.MethodPost, "/api/tracks?name=x.mp3", http.StatusUnauthorized},
		{"edit a track that is not there", "alice", http.MethodPatch, gone, http.StatusNotFound},
		{"delete a track that is not there", "alice", http.MethodDelete, gone, http.StatusNotFound},
		{"play a track that is not there", "alice", http.MethodGet, gone + "/audio", http.StatusNotFound},
		{"a path that is not an id", "alice", http.MethodGet, "/api/tracks/not-a-uuid/audio", http.StatusNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if w := h.do(t, tc.who, tc.method, tc.path, []byte(`{}`)); w.Code != tc.want {
				t.Errorf("status = %d, want %d", w.Code, tc.want)
			}
		})
	}
}

// #1095: the shelf is the rider's own. This was TestListShowsThePoolToEveryone
// and asserted the exact opposite, which was ADR-0015's decision while one
// instance meant one crew.
func TestListShowsOnlyYourOwnShelf(t *testing.T) {
	h := setup(t)
	h.upload(t, "alice", song(6, 383), "Hers.mp3")
	h.upload(t, "bob", song(7, 383), "His.mp3")

	w := h.do(t, "bob", http.MethodGet, "/api/tracks", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("list: %d", w.Code)
	}
	list, _ := decode(t, w)["tracks"].([]any)
	titles := map[string]string{}
	for _, item := range list {
		row, _ := item.(map[string]any)
		title, _ := row["title"].(string)
		uploader, _ := row["uploadedBy"].(string)
		titles[title] = uploader
	}
	if _, leaked := titles["Hers"]; leaked {
		t.Errorf("bob sees alice's upload: %v", titles)
	}
	if titles["His"] != "bob" {
		t.Errorf("bob cannot see his own upload: %v", titles)
	}
}

func TestSearchRanksTitleAboveAlbum(t *testing.T) {
	h := setup(t)
	byAlbum := h.upload(t, "alice", song(8, 383), "Something Else.mp3")
	byTitle := h.upload(t, "alice", song(9, 383), "Placeholder.mp3")

	// Put the word in one track's album and the other's title, so the ranking
	// has something to be right about rather than just the recency order.
	for _, tc := range []struct {
		track map[string]any
		body  string
	}{
		{byAlbum, `{"title":"Something Else","artist":"","album":"Thunderstruck","bpm":null}`},
		{byTitle, `{"title":"Thunderstruck","artist":"","album":"","bpm":null}`},
	} {
		id, _ := tc.track["id"].(string)
		if w := h.do(t, "alice", http.MethodPatch, "/api/tracks/"+id, []byte(tc.body)); w.Code != http.StatusOK {
			t.Fatalf("tag track: %d %s", w.Code, w.Body.String())
		}
	}

	w := h.do(t, "alice", http.MethodGet, "/api/tracks?q=thunderstruck", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("search: %d", w.Code)
	}
	list, _ := decode(t, w)["tracks"].([]any)
	if len(list) != 2 {
		t.Fatalf("found %d tracks, want both", len(list))
	}
	first, _ := list[0].(map[string]any)
	if first["title"] != "Thunderstruck" {
		t.Errorf("first hit = %v, want the title match ranked above the album match", first["title"])
	}
}

func TestSearchIsTolerantOfWhatRidersType(t *testing.T) {
	h := setup(t)
	track := h.upload(t, "alice", song(10, 383), "Placeholder.mp3")
	id, _ := track["id"].(string)
	if w := h.do(t, "alice", http.MethodPatch, "/api/tracks/"+id,
		[]byte(`{"title":"Midnight City","artist":"M83","album":"","bpm":null}`)); w.Code != http.StatusOK {
		t.Fatalf("tag: %d", w.Code)
	}

	found := func(q string) int {
		t.Helper()
		w := h.do(t, "alice", http.MethodGet, "/api/tracks?q="+url.QueryEscape(q), nil)
		if w.Code != http.StatusOK {
			t.Fatalf("search %q: %d", q, w.Code)
		}
		list, _ := decode(t, w)["tracks"].([]any)
		return len(list)
	}
	if n := found("midnight"); n != 1 {
		t.Errorf("one word of the title found %d, want 1", n)
	}
	if n := found("m83"); n != 1 {
		t.Errorf("the artist found %d, want 1", n)
	}
	// searchQuery keeps letters and digits only, so a rider typing
	// punctuation gets an answer rather than a 500 from a malformed tsquery
	// — and punctuation alone reads as nothing typed: the library, not a
	// "nothing matches" for three exclamation marks (#1421).
	if n := found(`"midnight city"`); n != 1 {
		t.Errorf("a quoted phrase found %d, want 1", n)
	}
	if n := found("!!! &|"); n < 1 {
		t.Errorf("junk found %d, want the library back and no error", n)
	}
	// Prefixes match as the rider types (#1421): the add box searches on
	// every keystroke, and "mid" has to find Midnight City.
	if n := found("mid ci"); n != 1 {
		t.Errorf("a prefix of each word found %d, want 1", n)
	}
	// An empty box is the whole library, not an empty page.
	if n := found(""); n < 1 {
		t.Errorf("clearing the search found %d, want the library back", n)
	}
}

func TestNormalizeTags(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   []string
		want []string
	}{
		{"case and padding are the same tag", []string{"Italo Disco", " italo disco "}, []string{"italo disco"}},
		{"inner whitespace collapses", []string{"drum\t\n  and   bass"}, []string{"drum and bass"}},
		{"empties drop out", []string{"", "   ", "techno"}, []string{"techno"}},
		{"order is the rider's", []string{"warmup", "acid", "warmup"}, []string{"warmup", "acid"}},
		{"nothing is an empty list, never nil", nil, []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := normalizeTags(tc.in)
			if !slices.Equal(got, tc.want) {
				t.Errorf("normalizeTags(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}

	t.Run("bounded on both axes", func(t *testing.T) {
		long := normalizeTags([]string{strings.Repeat("a", maxTagRunes+50)})
		if n := utf8.RuneCountInString(long[0]); n != maxTagRunes {
			t.Errorf("a long tag kept %d runes, want it clipped to %d", n, maxTagRunes)
		}
		many := make([]string, maxTags+10)
		for i := range many {
			many[i] = fmt.Sprintf("tag%d", i)
		}
		if got := normalizeTags(many); len(got) != maxTags {
			t.Errorf("kept %d tags, want the list capped at %d", len(got), maxTags)
		}
	})
}

// id3v23 wraps `data` in an ID3v2.3 tag carrying one text frame, which is the
// only way to give a synthetic MP3 a genre for the upload path to read.
func id3v23(frameID, text string, data []byte) []byte {
	payload := append([]byte{0x00}, text...) // 0x00 = ISO-8859-1

	// Both lengths fit a byte: the text a test tags a track with is a few
	// words, so the wide ends of these size fields are always zero.
	frame := append([]byte(frameID), 0, 0, 0, byte(len(payload)), 0x00, 0x00) //nolint:gosec // test text, well under 255
	frame = append(frame, payload...)

	// The tag header's size is synchsafe — seven bits per byte.
	header := []byte{'I', 'D', '3', 3, 0, 0, 0, 0, byte(len(frame) >> 7 & 0x7F), byte(len(frame) & 0x7F)} //nolint:gosec // masked to 7 bits
	return append(append(header, frame...), data...)
}

func TestTheGenreFrameSeedsTheFirstTags(t *testing.T) {
	h := setup(t)
	// "Synthwave/Italo Disco" — one frame, the way a tagger writes two genres.
	data := id3v23("TCON", "Synthwave/Italo Disco", song(11, 383))
	body := h.upload(t, "alice", data, "Seeded.mp3")

	tags, _ := body["tags"].([]any)
	if len(tags) != 2 || tags[0] != "synthwave" || tags[1] != "italo disco" {
		t.Errorf("tags = %v, want the genre frame split and normalized", body["tags"])
	}
}

func TestATrackWithNoGenreCarriesAnEmptyTagList(t *testing.T) {
	h := setup(t)
	body := h.upload(t, "alice", song(12, 383), "Bare.mp3")
	// `[]`, not `null`: the client iterates it without asking which it got.
	tags, ok := body["tags"].([]any)
	if !ok || len(tags) != 0 {
		t.Errorf("tags = %#v, want an empty list", body["tags"])
	}
}

func TestTagsFilterThePoolAndCountThemselves(t *testing.T) {
	h := setup(t)
	// Tag names unique to this run: the pool is global and `wattroom_test` is
	// shared, so a facet count is only ever assertable about our own tags.
	mine := fmt.Sprintf("sprint-%d", time.Now().UnixNano())
	other := mine + "-cooldown"

	for i, tags := range [][]string{{mine}, {mine, other}, {other}} {
		track := h.upload(t, "alice", song(byte(13+i), 383), fmt.Sprintf("Tagged %d.mp3", i))
		id, _ := track["id"].(string)
		edit, _ := json.Marshal(map[string]any{
			"title": fmt.Sprintf("Tagged %d", i), "artist": "", "album": "", "bpm": nil, "tags": tags,
		})
		if w := h.do(t, "alice", http.MethodPatch, "/api/tracks/"+id, edit); w.Code != http.StatusOK {
			t.Fatalf("tag track %d: %d %s", i, w.Code, w.Body.String())
		}
	}

	list := func(query string) []any {
		t.Helper()
		w := h.do(t, "alice", http.MethodGet, "/api/tracks?"+query, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("list %q: %d %s", query, w.Code, w.Body.String())
		}
		rows, _ := decode(t, w)["tracks"].([]any)
		return rows
	}

	if n := len(list("tag=" + url.QueryEscape(mine))); n != 2 {
		t.Errorf("filtering by %q found %d tracks, want 2", mine, n)
	}
	if n := len(list("tag=" + url.QueryEscape(other))); n != 2 {
		t.Errorf("filtering by %q found %d tracks, want 2", other, n)
	}
	// A rider clicking a chip whose name they half-typed gets the same shelf:
	// the filter normalizes the way the stored tag did.
	if n := len(list("tag=" + url.QueryEscape("  "+strings.ToUpper(mine)+" "))); n != 2 {
		t.Errorf("a differently-cased tag found %d tracks, want the same 2", n)
	}
	// Search and tag narrow together rather than replacing each other.
	if n := len(list("tag=" + url.QueryEscape(mine) + "&q=" + url.QueryEscape("Tagged 1"))); n != 1 {
		t.Errorf("tag and search together found %d, want 1", n)
	}
	if n := len(list("tag=" + url.QueryEscape(mine+"-nobody-wears-this"))); n != 0 {
		t.Errorf("an unworn tag found %d tracks, want 0", n)
	}

	// The facet row carries the shelf labels with their counts.
	w := h.do(t, "alice", http.MethodGet, "/api/tracks", nil)
	facets, _ := decode(t, w)["tags"].([]any)
	counts := map[string]float64{}
	for _, item := range facets {
		row, _ := item.(map[string]any)
		tag, _ := row["tag"].(string)
		counts[tag], _ = row["tracks"].(float64)
	}
	if counts[mine] != 2 || counts[other] != 2 {
		t.Errorf("facets = %v/%v for %q/%q, want 2 and 2", counts[mine], counts[other], mine, other)
	}
}

// The blob is refcounted (#1095). One file backs however many shelves hold
// the song, so deleting a row may only take the file with it when it is the
// LAST row pointing there. Getting this wrong breaks the other holder's
// playback, and nothing says so until they press play — there is no error,
// no log line and no failing request, just silence where a song was.
func TestDeletingOneShelfsCopyLeavesTheFileForTheOther(t *testing.T) {
	h := setup(t)
	data := song(12, 383)
	sha := Address(data)
	path := filepath.Join(h.dir, sha[:2], sha+".mp3")

	hersRow := h.upload(t, "alice", data, "Ours.mp3")
	hisRow := h.upload(t, "bob", data, "Ours.mp3")
	hers, _ := hersRow["id"].(string)
	his, _ := hisRow["id"].(string)
	if hers == his || hers == "" {
		t.Fatal("one row for two shelves — the rest of this test proves nothing")
	}

	// Alice deletes hers. Bob still holds it, so the bytes must stay.
	if w := h.do(t, "alice", http.MethodDelete, "/api/tracks/"+hers, nil); w.Code != http.StatusNoContent {
		t.Fatalf("alice delete: %d", w.Code)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("the file went with the first row: %v", err)
	}
	// And bob can still play it — the point of keeping the file.
	if w := h.do(t, "bob", http.MethodGet, "/api/tracks/"+his+"/audio", nil); w.Code != http.StatusOK {
		t.Errorf("bob's playback broke: %d", w.Code)
	}

	// Bob deletes his: last row out takes the file.
	if w := h.do(t, "bob", http.MethodDelete, "/api/tracks/"+his, nil); w.Code != http.StatusNoContent {
		t.Fatalf("bob delete: %d", w.Code)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("the last row left the file behind: %v", err)
	}
}

// The facet row is a shelf label, and an unscoped one is a listing of what
// strangers are into (#1095). It fails quietly: the tag chip appears, and
// clicking it returns nothing, so it reads as an empty shelf rather than as
// a leak — while still having named somebody else's taste.
func TestTagFacetsCountOnlyYourOwnShelf(t *testing.T) {
	h := setup(t)
	// Unique to this run: `wattroom_test` is shared between suites, so a
	// facet assertion is only ever safe about tags nobody else wrote.
	hers := fmt.Sprintf("herowntag-%d", time.Now().UnixNano())

	track := h.upload(t, "alice", song(20, 383), "Hers.mp3")
	id, _ := track["id"].(string)
	edit, _ := json.Marshal(map[string]any{
		"title": "Hers", "artist": "", "album": "", "bpm": nil, "tags": []string{hers},
	})
	if w := h.do(t, "alice", http.MethodPatch, "/api/tracks/"+id, edit); w.Code != http.StatusOK {
		t.Fatalf("tag: %d %s", w.Code, w.Body.String())
	}

	// Bob has a shelf of his own, so his list is not empty for the wrong reason.
	h.upload(t, "bob", song(21, 383), "His.mp3")

	w := h.do(t, "bob", http.MethodGet, "/api/tracks", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("list: %d", w.Code)
	}
	facets, _ := decode(t, w)["tags"].([]any)
	for _, item := range facets {
		row, _ := item.(map[string]any)
		if row["tag"] == hers {
			t.Fatalf("bob's shelf labels name alice's tag: %v", facets)
		}
	}

	// And alice still sees her own, so the scoping did not just empty it.
	w = h.do(t, "alice", http.MethodGet, "/api/tracks", nil)
	facets, _ = decode(t, w)["tags"].([]any)
	found := false
	for _, item := range facets {
		row, _ := item.(map[string]any)
		if row["tag"] == hers {
			found = true
		}
	}
	if !found {
		t.Errorf("alice cannot see her own tag: %v", facets)
	}
}

// The regression the uploader-only scope would have shipped (#1095). A pool
// track on a room's deck is fetched from this endpoint by EVERY rider in the
// room — `AudioDeck.svelte` — so scoping playback to the uploader leaves a
// queued track playing for its owner and silent for everyone else, with no
// error anywhere and no test to say so. Playing is what sharing a room
// permits; browsing is not, and this asserts both halves.
func TestARoomMateCanPlayYourTrackButNotBrowseYourShelf(t *testing.T) {
	h := setup(t)
	track := h.upload(t, "alice", song(22, 383), "Queued.mp3")
	id, _ := track["id"].(string)

	// Before they share a room, bob cannot even hear it.
	if w := h.do(t, "bob", http.MethodGet, "/api/tracks/"+id+"/audio", nil); w.Code != http.StatusNotFound {
		t.Errorf("a stranger played it: %d, want 404", w.Code)
	}

	h.sharedRoom(t, "alice", "bob")

	// Now bob is in a room with alice, so the deck's track plays for him.
	if w := h.do(t, "bob", http.MethodGet, "/api/tracks/"+id+"/audio", nil); w.Code != http.StatusOK {
		t.Errorf("a room-mate could not play the deck's track: %d", w.Code)
	}
	// But her shelf is still hers: not in his list, not his to edit or delete.
	w := h.do(t, "bob", http.MethodGet, "/api/tracks", nil)
	list, _ := decode(t, w)["tracks"].([]any)
	for _, item := range list {
		if row, _ := item.(map[string]any); row["id"] == id {
			t.Error("sharing a room put her library on his shelf")
		}
	}
	edit := []byte(`{"title":"Mine now","artist":"","album":"","bpm":null,"tags":[]}`)
	if w := h.do(t, "bob", http.MethodPatch, "/api/tracks/"+id, edit); w.Code != http.StatusNotFound {
		t.Errorf("a room-mate edited her track: %d, want 404", w.Code)
	}
	if w := h.do(t, "bob", http.MethodDelete, "/api/tracks/"+id, nil); w.Code != http.StatusNotFound {
		t.Errorf("a room-mate deleted her track: %d, want 404", w.Code)
	}
}

// sharedRoom puts two riders in one room, which is the trust boundary the
// audio endpoint reads.
func (h *harness) sharedRoom(t *testing.T, a, b string) db.Room {
	t.Helper()
	room, err := h.store.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Slug: "shared-" + strings.ToLower(strings.ReplaceAll(t.Name(), "/", "-")),
		Name: "Shared", OwnerID: h.users.byToken[a].ID,
	})
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID)
	})
	for _, who := range []string{a, b} {
		if err := h.store.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
			RoomID: room.ID, UserID: h.users.byToken[who].ID, Role: "member",
		}); err != nil {
			t.Fatalf("membership %s: %v", who, err)
		}
	}
	return room
}

// A ban keeps the membership row (ADR-0013), so the "shares a room" join
// counts it unless it says otherwise — and this endpoint is the one that
// hands over the bytes. #1110 fixed the same hole in the trophy case; this
// is its sibling, found by the audit in #1113.
func TestABannedRiderCannotPlayTheRoomsTracks(t *testing.T) {
	h := setup(t)
	track := h.upload(t, "alice", song(22, 383), "Queued.mp3")
	id, _ := track["id"].(string)
	room := h.sharedRoom(t, "alice", "bob")

	if w := h.do(t, "bob", http.MethodGet, "/api/tracks/"+id+"/audio", nil); w.Code != http.StatusOK {
		t.Fatalf("bob could not play it before the ban (%d) — test proves nothing", w.Code)
	}

	if _, err := h.store.Queries.UpdateMembershipRole(t.Context(), db.UpdateMembershipRoleParams{
		RoomID: room.ID, UserID: h.users.byToken["bob"].ID, Role: "banned",
	}); err != nil {
		t.Fatalf("ban: %v", err)
	}

	if w := h.do(t, "bob", http.MethodGet, "/api/tracks/"+id+"/audio", nil); w.Code != http.StatusNotFound {
		t.Errorf("a banned rider still played the room's track: %d, want 404", w.Code)
	}
	// The ban is one-way in the row but two-way in the join: alice is not
	// banned anywhere, so her own track must still play for her.
	if w := h.do(t, "alice", http.MethodGet, "/api/tracks/"+id+"/audio", nil); w.Code != http.StatusOK {
		t.Errorf("banning bob cost alice her own track: %d", w.Code)
	}
}
