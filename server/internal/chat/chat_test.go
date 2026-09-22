package chat

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/budget"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// tinyPNG is just the signature — enough for http.DetectContentType.
var tinyPNG = []byte("\x89PNG\r\n\x1a\nrest-of-a-picture")

func (w channelWorld) upload(t *testing.T, who, channel string, body []byte) (int, string) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/channels/"+channel+"/chat/images", bytes.NewReader(body))
	if who != "" {
		req.Header.Set("X-Test-User", who)
	}
	rec := httptest.NewRecorder()
	w.mux.ServeHTTP(rec, req)
	var out struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&out)
	return rec.Code, out.ID
}

func (w channelWorld) image(t *testing.T, who, channel, id string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/channels/"+channel+"/chat/images/"+id, nil)
	if who != "" {
		req.Header.Set("X-Test-User", who)
	}
	rec := httptest.NewRecorder()
	w.mux.ServeHTTP(rec, req)
	return rec
}

func (w channelWorld) channelID(t *testing.T, channel string) pgtype.UUID {
	t.Helper()
	id, err := store.ParseUUID(channel)
	if err != nil {
		t.Fatalf("channel id %q: %v", channel, err)
	}
	return id
}

// The backlog names each line's author by name and by id (#219) — namesake-
// proof — and carries every reaction's count with the ones the viewer pressed.
func TestChannelBacklogCarriesAuthorsAndReactions(t *testing.T) {
	w := channelSetup(t)
	alice, bob := w.users.ByToken["alice"], w.users.ByToken["bob"]
	first := w.say(t, "alice", w.open, "warm-up at 7?")
	w.say(t, "bob", w.open, "in")
	// On, a second rider on, the first off again: one left, and it is cara's.
	for _, who := range []string{"bob", "cara", "bob"} {
		if status, body := post(t, w.mux, who, "/api/channels/"+w.open+"/chat/reactions", `{"messageId":"`+first+`","emoji":"🔥"}`); status != http.StatusOK {
			t.Fatalf("%s reacting: %d %v", who, status, body)
		}
	}

	messages := w.messages(t, "cara", w.open)
	if len(messages) != 2 || messages[0]["from"] != "alice" || messages[1]["from"] != "bob" {
		t.Fatalf("order/authors: %v", messages)
	}
	if messages[0]["fromId"] != store.UUIDString(alice.ID) || messages[1]["fromId"] != store.UUIDString(bob.ID) {
		t.Fatalf("author ids: %v", messages)
	}
	reactions, _ := messages[0]["reactions"].(map[string]any)
	if reactions["🔥"] != float64(1) {
		t.Fatalf("backlog count: %v", messages[0])
	}
	mine, _ := messages[0]["mine"].([]any)
	if len(mine) != 1 || mine[0] != "🔥" {
		t.Fatalf("cara's own reaction: %v", messages[0])
	}
	// The count is everyone's; "mine" is the viewer's alone.
	if pressed, ok := w.messages(t, "alice", w.open)[0]["mine"]; ok {
		t.Fatalf("alice pressed nothing, backlog says %v", pressed)
	}
}

func TestChannelChatImages(t *testing.T) {
	w := channelSetup(t)

	// Boundary: no auth 401, outside the crew 404, junk bytes 400.
	if code, _ := w.upload(t, "", w.open, tinyPNG); code != http.StatusUnauthorized {
		t.Fatalf("unauthed upload: %d", code)
	}
	if code, _ := w.upload(t, "dave", w.open, tinyPNG); code != http.StatusNotFound {
		t.Fatalf("an upload from outside the crew: %d", code)
	}
	if code, _ := w.upload(t, "alice", w.open, []byte("not an image")); code != http.StatusBadRequest {
		t.Fatalf("junk upload: %d", code)
	}

	code, imgID := w.upload(t, "alice", w.open, tinyPNG)
	if code != http.StatusOK || imgID == "" {
		t.Fatalf("upload: %d %q", code, imgID)
	}

	// The channel reads it back byte-for-byte; outsiders and junk ids do not.
	res := w.image(t, "bob", w.open, imgID)
	if res.Code != http.StatusOK || res.Header().Get("Content-Type") != "image/png" || !bytes.Equal(res.Body.Bytes(), tinyPNG) {
		t.Fatalf("serve: %d %q", res.Code, res.Header().Get("Content-Type"))
	}
	// Member bytes on our own origin: the browser must not re-sniff them.
	if res.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("blob served without nosniff")
	}
	if res := w.image(t, "dave", w.open, imgID); res.Code != http.StatusNotFound {
		t.Fatalf("served outside the crew: %d", res.Code)
	}
	if res := w.image(t, "alice", w.open, "not-a-uuid"); res.Code != http.StatusNotFound {
		t.Fatalf("junk id: %d", res.Code)
	}
	// The channel is the privacy boundary: the same id through another
	// channel must 404 even for a rider who may enter both.
	if res := w.image(t, "alice", w.private, imgID); res.Code != http.StatusNotFound {
		t.Fatalf("cross-channel serve: %d", res.Code)
	}

	// A line carrying the id surfaces it in the backlog.
	if status, body := post(t, w.mux, "alice", "/api/channels/"+w.open+"/chat", `{"text":"","imageId":"`+imgID+`"}`); status != http.StatusOK {
		t.Fatalf("a line with only a picture: %d %v", status, body)
	}
	messages := w.messages(t, "alice", w.open)
	if last := messages[len(messages)-1]; last["imageId"] != imgID {
		t.Fatalf("backlog imageId: %v", last)
	}
}

func TestPruneChannelImagesSweepsOnlyUnreferenced(t *testing.T) {
	w := channelSetup(t)
	channel := w.channelID(t, w.open)

	_, sent := w.upload(t, "alice", w.open, tinyPNG)
	_, orphan := w.upload(t, "alice", w.open, tinyPNG)
	if status, body := post(t, w.mux, "alice", "/api/channels/"+w.open+"/chat", `{"text":"","imageId":"`+sent+`"}`); status != http.StatusOK {
		t.Fatalf("send: %d %v", status, body)
	}
	// Age both past the 15-minute grace; only the never-sent one may go.
	if _, err := w.svc.store.Pool.Exec(t.Context(),
		"update chat_images set created_at = now() - interval '1 hour' where channel_id = $1", channel); err != nil {
		t.Fatal(err)
	}
	if err := w.svc.store.Queries.PruneChannelImages(t.Context(), channel); err != nil {
		t.Fatal(err)
	}
	if res := w.image(t, "alice", w.open, sent); res.Code != http.StatusOK {
		t.Fatalf("referenced image swept: %d", res.Code)
	}
	if res := w.image(t, "alice", w.open, orphan); res.Code != http.StatusNotFound {
		t.Fatalf("orphan survived: %d", res.Code)
	}
}

func TestChatImageFromAnotherChannelIsRefused(t *testing.T) {
	w := channelSetup(t)
	_, theirs := w.upload(t, "alice", w.private, tinyPNG)
	if theirs == "" {
		t.Fatal("upload to the other channel failed")
	}
	// Referencing it from the open channel must not persist: serving is
	// channel-scoped anyway, but the reference alone would pin the bytes past
	// the sweep.
	img, _ := store.ParseUUID(theirs)
	if _, err := w.svc.store.Queries.SaveChannelMessage(t.Context(), db.SaveChannelMessageParams{
		ChannelID: w.channelID(t, w.open), UserID: w.users.ByToken["alice"].ID, Text: "look", ImageID: img,
		CreatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("cross-channel image reference accepted: %v", err)
	}
	// Over HTTP the refusal is the rider's to act on (#1987): a 400 naming
	// the field, not a 500 with a retry that could never work.
	code, body := post(t, w.mux, "alice", "/api/channels/"+w.open+"/chat", `{"text":"look","imageId":"`+theirs+`"}`)
	if code != http.StatusBadRequest || body["field"] != "imageId" {
		t.Fatalf("foreign image over http: %d %v", code, body)
	}
}

// One account's writes are bounded (#1982) the way the DM door's are: posts,
// edits and reactions share a minute, uploads an hour, and another member is
// not held back by it.
func TestChannelChatWritesAreBoundedPerAccount(t *testing.T) {
	w := channelSetup(t)
	w.svc.lines = budget.New[pgtype.UUID](2, time.Minute)
	w.svc.uploads = budget.New[pgtype.UUID](1, time.Hour)
	chat := "/api/channels/" + w.open + "/chat"

	var id string
	for i := 0; i < 2; i++ {
		code, body := post(t, w.mux, "alice", chat, `{"text":"hi"}`)
		if code != http.StatusOK {
			t.Fatalf("post %d: %d %v", i, code, body)
		}
		id, _ = body["id"].(string)
	}
	code, body := post(t, w.mux, "alice", chat, `{"text":"one more"}`)
	if code != http.StatusTooManyRequests || body["error"] != "rate_limited" {
		t.Fatalf("the third line in a minute: %d %v", code, body)
	}
	if code, _ := post(t, w.mux, "alice", chat+"/reactions", `{"messageId":"`+id+`","emoji":"🔥"}`); code != http.StatusTooManyRequests {
		t.Fatalf("a reaction past the ceiling: %d", code)
	}
	if code, _ := post(t, w.mux, "bob", chat, `{"text":"still here"}`); code != http.StatusOK {
		t.Fatalf("bob held back by alice's ceiling: %d", code)
	}
	if _, img := w.upload(t, "alice", w.open, tinyPNG); img == "" {
		t.Fatal("first upload refused")
	}
	if code, _ := w.upload(t, "alice", w.open, tinyPNG); code != http.StatusTooManyRequests {
		t.Fatalf("the second upload in an hour: %d", code)
	}
}

// One line, one millisecond (#2421). The post answers with the `At` it
// stamped; the rail announces the same line by the row's created_at, and the
// dedup that stops both of them speaking keys off that number. While the
// column timed itself the two disagreed, and one message made two sounds.
func TestChannelLineKeepsItsOwnTimestamp(t *testing.T) {
	w := channelSetup(t)
	at := time.Now().Add(-90 * time.Second).UnixMilli()
	if _, err := w.svc.store.Queries.SaveChannelMessage(t.Context(), db.SaveChannelMessageParams{
		ChannelID: w.channelID(t, w.open), UserID: w.users.ByToken["alice"].ID, Text: "back in ten",
		CreatedAt: pgtype.Timestamptz{Time: time.UnixMilli(at), Valid: true},
	}); err != nil {
		t.Fatalf("save: %v", err)
	}
	messages := w.messages(t, "alice", w.open)
	if len(messages) != 1 {
		t.Fatalf("backlog: %v", messages)
	}
	ms, ok := messages[0]["at"].(float64)
	if !ok {
		t.Fatalf("no at on the line: %v", messages[0])
	}
	if got := int64(ms); got != at {
		t.Errorf("at = %d, want %d — the row timed itself instead of the line", got, at)
	}

	// And the post writes the moment it answers with.
	status, body := post(t, w.mux, "alice", "/api/channels/"+w.open+"/chat", `{"text":"back"}`)
	if status != http.StatusOK {
		t.Fatalf("post: %d %v", status, body)
	}
	messages = w.messages(t, "alice", w.open)
	if last := messages[len(messages)-1]; last["id"] != body["id"] || last["at"] != body["at"] {
		t.Errorf("the post answered at %v, the row says %v", body["at"], last["at"])
	}
}
