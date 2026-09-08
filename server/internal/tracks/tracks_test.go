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
	dsn := os.Getenv("WATTROOM_TEST_DB")
	if dsn == "" {
		dsn = "postgres://wattroom:wattroom@localhost:5432/wattroom_test" //nolint:gosec // compose test credentials
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	st, err := store.Open(ctx, dsn)
	if err != nil {
		t.Skipf("no database available: %v", err)
	}
	t.Cleanup(st.Close)

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

func TestASecondUploadOfTheSameSongStoresNothingNew(t *testing.T) {
	h := setup(t)
	data := song(2, 383)
	first := h.upload(t, "alice", data, "Shared.mp3")

	// Bob uploads the same bytes: he gets the track that is already there.
	w := h.do(t, "bob", http.MethodPost, "/api/tracks?name=Shared.mp3", data)
	if w.Code != http.StatusOK {
		t.Fatalf("duplicate upload: %d %s", w.Code, w.Body.String())
	}
	if decode(t, w)["id"] != first["id"] {
		t.Errorf("a duplicate made a second track")
	}
	// And it charged nobody: bob stored no bytes, so his quota is untouched.
	used, err := h.store.Queries.TrackQuotaUsed(t.Context(), h.users.byToken["bob"].ID)
	if err != nil {
		t.Fatalf("quota: %v", err)
	}
	if used != 0 {
		t.Errorf("bob's quota = %d, want 0 — he stored nothing", used)
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
	// Anyone signed in can play it: one global pool (ADR-0015).
	w := h.do(t, "bob", http.MethodGet, path, nil)
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
	req.Header.Set("X-Test-User", "bob")
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
	if w := h.do(t, "bob", http.MethodPatch, "/api/tracks/"+id, edit); w.Code != http.StatusForbidden {
		t.Errorf("bob edited alice's track: %d", w.Code)
	}
	if w := h.do(t, "bob", http.MethodDelete, "/api/tracks/"+id, nil); w.Code != http.StatusForbidden {
		t.Errorf("bob deleted alice's track: %d", w.Code)
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

func TestListShowsThePoolToEveryone(t *testing.T) {
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
	// One global pool: bob sees alice's upload, with her name on it.
	if titles["Hers"] != "alice" || titles["His"] != "bob" {
		t.Errorf("pool = %v, want both tracks with their uploaders", titles)
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
	// websearch_to_tsquery, so a rider typing punctuation gets an answer
	// rather than a 500 from a malformed tsquery.
	if n := found(`"midnight city"`); n != 1 {
		t.Errorf("a quoted phrase found %d, want 1", n)
	}
	if n := found("!!! &|"); n != 0 {
		t.Errorf("junk found %d, want 0 and no error", n)
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
