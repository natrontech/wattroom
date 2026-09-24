package chat

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/channels"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// A text channel's chat (#2435), behind the real channel gate.

// fakeLobby is the hub's lobby: it remembers which channels it was told
// moved, and whose reads.
type fakeLobby struct {
	mu    sync.Mutex
	pings []string
	reads []string
}

func (f *fakeLobby) ReadChanged(userID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reads = append(f.reads, userID)
}

func (f *fakeLobby) ChannelChanged(id string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pings = append(f.pings, id)
}

func (f *fakeLobby) heard() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.pings...)
}

type channelWorld struct {
	svc   *Service
	mux   *http.ServeMux
	lobby *fakeLobby
	users *testx.Users
	crew  pgtype.UUID
	// open: every member; private: bob named; voice: no chat of its own.
	open, private, voice string
}

// channelSetup: alice owns a crew bob and cara are members of; dave is in
// none of it.
func channelSetup(t *testing.T) channelWorld {
	t.Helper()
	st := storetest.Open(t)
	users := &testx.Users{ByToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob", "cara", "dave"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: name, FtpWatts: 200, WeightKg: 75})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.ByToken[name] = u
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from crews where owner_id = $1", u.ID)
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
	}
	code := rand.Text()[:6]
	crew, err := st.Queries.CreateCrew(t.Context(), db.CreateCrewParams{Name: "Chat Crew", OwnerID: users.ByToken["alice"].ID, Code: &code})
	if err != nil {
		t.Fatalf("crew: %v", err)
	}
	for _, name := range []string{"bob", "cara"} {
		if err := st.Queries.JoinCrew(t.Context(), db.JoinCrewParams{CrewID: crew.ID, UserID: users.ByToken[name].ID}); err != nil {
			t.Fatalf("join %s: %v", name, err)
		}
	}
	channel := func(kind, name string, private bool) string {
		var id pgtype.UUID
		if err := st.Pool.QueryRow(t.Context(),
			`insert into channels (crew_id, kind, name, position, private) values ($1, $2, $3, 0, $4) returning id`,
			crew.ID, kind, name, private).Scan(&id); err != nil {
			t.Fatalf("channel %s: %v", name, err)
		}
		return store.UUIDString(id)
	}
	w := channelWorld{users: users, crew: crew.ID, lobby: &fakeLobby{},
		open: channel("text", "general", false), private: channel("text", "coaches", true), voice: channel("voice", "ride", false)}
	if _, err := st.Pool.Exec(t.Context(), `insert into channel_members (channel_id, user_id) values ($1, $2)`,
		w.private, users.ByToken["bob"].ID); err != nil {
		t.Fatalf("name bob: %v", err)
	}
	log := slog.New(slog.DiscardHandler)
	w.svc = New(st, log)
	w.mux = http.NewServeMux()
	w.svc.RegisterChannels(w.mux, channels.New(st, users, log), w.lobby)
	return w
}

func (w channelWorld) chat(t *testing.T, who, channel string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/channels/"+channel+"/chat", nil)
	if who != "" {
		req.Header.Set("X-Test-User", who)
	}
	rec := httptest.NewRecorder()
	w.mux.ServeHTTP(rec, req)
	var body map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&body)
	return rec.Code, body
}

// messages is the channel's backlog as the client decodes it.
func (w channelWorld) messages(t *testing.T, who, channel string) []map[string]any {
	t.Helper()
	status, body := w.chat(t, who, channel)
	if status != http.StatusOK {
		t.Fatalf("%s reading %s: %d %v", who, channel, status, body)
	}
	var out []map[string]any
	msgs, _ := body["messages"].([]any)
	for _, m := range msgs {
		line, _ := m.(map[string]any)
		out = append(out, line)
	}
	return out
}

func (w channelWorld) lines(t *testing.T, who, channel string) []string {
	t.Helper()
	var out []string
	for _, line := range w.messages(t, who, channel) {
		out = append(out, fmt.Sprint(line["text"]))
	}
	return out
}

// readAt is where the viewer's "N new" divider goes; zero when they never read.
func (w channelWorld) readAt(t *testing.T, who, channel string) float64 {
	t.Helper()
	_, body := w.chat(t, who, channel)
	stamp, _ := body["readAt"].(float64)
	return stamp
}

// unread is the count on who's sidebar badge for one channel.
func (w channelWorld) unread(t *testing.T, who, channel string) int32 {
	t.Helper()
	rows, err := w.svc.store.Queries.UnreadByChannel(t.Context(), db.UnreadByChannelParams{
		UserID: w.users.ByToken[who].ID, ChannelIds: []pgtype.UUID{w.channelID(t, channel)},
	})
	if err != nil {
		t.Fatal(err)
	}
	var n int32
	for _, row := range rows {
		n += row.Unread
	}
	return n
}

// pings is how many times the lobby has been told a channel moved.
func (w channelWorld) pings() int { return len(w.lobby.heard()) }

// setRole makes a crew member an admin, a member again, or banned.
func (w channelWorld) setRole(t *testing.T, who, role string) {
	t.Helper()
	if err := w.svc.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: w.crew, UserID: w.users.ByToken[who].ID, Role: role,
	}); err != nil {
		t.Fatalf("%s as %s: %v", who, role, err)
	}
}

// post runs one JSON POST as a user ("" = signed out) and decodes the answer.
func post(t *testing.T, mux *http.ServeMux, user, path, body string) (int, map[string]any) {
	t.Helper()
	return send(t, mux, http.MethodPost, user, path, body)
}

// patch runs one JSON PATCH as a user ("" = signed out) and decodes the answer.
func patch(t *testing.T, mux *http.ServeMux, user, path, body string) (int, map[string]any) {
	t.Helper()
	return send(t, mux, http.MethodPatch, user, path, body)
}

// del runs one DELETE as a user ("" = signed out).
func del(t *testing.T, mux *http.ServeMux, user, path string) (int, map[string]any) {
	t.Helper()
	return send(t, mux, http.MethodDelete, user, path, "")
}

func send(t *testing.T, mux *http.ServeMux, method, user, path, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	var decoded map[string]any
	_ = json.NewDecoder(w.Body).Decode(&decoded)
	return w.Code, decoded
}

func (w channelWorld) say(t *testing.T, who, channel, text string) string {
	t.Helper()
	status, body := post(t, w.mux, who, "/api/channels/"+channel+"/chat", fmt.Sprintf(`{"text":%q}`, text))
	if status != http.StatusOK {
		t.Fatalf("%s saying %q: %d %v", who, text, status, body)
	}
	id, _ := body["id"].(string)
	return id
}

// Two riders in one text channel read each other within one ping, and neither
// holds a socket: the post names the channel to the lobby, and the other
// rider's re-fetch has the line (#2435's bar).
func TestTwoRidersInATextChannelHearEachOtherByPing(t *testing.T) {
	w := channelSetup(t)
	w.say(t, "bob", w.open, "anyone out tonight?")
	if heard := w.lobby.heard(); len(heard) != 1 || heard[0] != w.open {
		t.Fatalf("the lobby heard %v, want one ping naming %s", heard, w.open)
	}
	if got := w.lines(t, "alice", w.open); len(got) != 1 || got[0] != "anyone out tonight?" {
		t.Fatalf("alice's re-fetch = %v", got)
	}
	w.say(t, "alice", w.open, "at seven")
	if got := w.lines(t, "bob", w.open); len(got) != 2 || got[1] != "at seven" {
		t.Errorf("bob's re-fetch = %v", got)
	}
}

// The gate is the channel's: signed out 401, a private channel you are not
// named into and a voice channel both 404, as does a channel that is not there.
func TestChannelChatStandsBehindTheChannelGate(t *testing.T) {
	w := channelSetup(t)
	for _, c := range []struct {
		who, channel string
		want         int
	}{
		{"", w.open, http.StatusUnauthorized},
		{"cara", w.open, http.StatusOK},
		{"cara", w.private, http.StatusNotFound},
		{"bob", w.private, http.StatusOK},
		{"alice", w.private, http.StatusOK},
		{"alice", w.voice, http.StatusNotFound},
		{"alice", "not-a-channel", http.StatusNotFound},
	} {
		if status, _ := w.chat(t, c.who, c.channel); status != c.want {
			t.Errorf("%q reading %s = %d, want %d", c.who, c.channel, status, c.want)
		}
	}
	if status, _ := post(t, w.mux, "cara", "/api/channels/"+w.private+"/chat", `{"text":"let me in"}`); status != http.StatusNotFound {
		t.Errorf("cara posted into a private channel: %d", status)
	}
	if status, _ := post(t, w.mux, "bob", "/api/channels/"+w.open+"/chat", `{"text":""}`); status != http.StatusBadRequest {
		t.Errorf("an empty line: %d, want 400", status)
	}
}

// A crew's ban stops at its chat too (#638): the banned rider keeps a row in
// crew_roles, but neither the backlog, a post nor an upload is theirs — and a
// 404 like any channel they may not enter, not a 403 that confirms it.
func TestBannedRiderRefusedAtChannelChat(t *testing.T) {
	w := channelSetup(t)
	w.say(t, "bob", w.open, "before")
	w.setRole(t, "bob", "banned")
	if status, body := w.chat(t, "bob", w.open); status != http.StatusNotFound {
		t.Errorf("banned rider read the backlog: %d %v", status, body)
	}
	if status, _ := post(t, w.mux, "bob", "/api/channels/"+w.open+"/chat", `{"text":"still here"}`); status != http.StatusNotFound {
		t.Errorf("banned rider posted: %d", status)
	}
	if status, _ := w.upload(t, "bob", w.open, tinyPNG); status != http.StatusNotFound {
		t.Errorf("banned rider uploaded an image: %d", status)
	}
	// Nothing leaked into the channel: the crew still sees one line.
	if got := w.lines(t, "alice", w.open); len(got) != 1 {
		t.Errorf("backlog after the refused post: %v", got)
	}
}

// Edit and delete: the author's, and a crew admin's to delete; a line from
// another channel is not a line here.
func TestEditAndDeleteInAChannel(t *testing.T) {
	w := channelSetup(t)
	line := w.say(t, "bob", w.open, "typo hre")
	path := "/api/channels/" + w.open + "/chat/" + line

	if status, _ := patch(t, w.mux, "cara", path, `{"text":"mine now"}`); status != http.StatusForbidden {
		t.Errorf("cara edited bob's line: %d, want 403", status)
	}
	if status, body := patch(t, w.mux, "bob", path, `{"text":"typo here"}`); status != http.StatusOK || body["editedAt"] == nil {
		t.Errorf("bob's edit: %d %v", status, body)
	}
	if got := w.lines(t, "cara", w.open); len(got) != 1 || got[0] != "typo here" {
		t.Errorf("after the edit: %v", got)
	}
	// The same id addressed through another channel is nobody's line.
	if status, _ := patch(t, w.mux, "bob", "/api/channels/"+w.private+"/chat/"+line, `{"text":"x"}`); status != http.StatusNotFound {
		t.Errorf("an edit through another channel: %d, want 404", status)
	}
	if status, _ := del(t, w.mux, "cara", path); status != http.StatusForbidden {
		t.Errorf("cara deleted bob's line: %d, want 403", status)
	}
	if status, _ := del(t, w.mux, "alice", path); status != http.StatusNoContent {
		t.Errorf("the crew's owner deleting a line: %d, want 204", status)
	}
	if got := w.lines(t, "bob", w.open); len(got) != 0 {
		t.Errorf("the deleted line is still there: %v", got)
	}
	if status, _ := del(t, w.mux, "alice", path); status != http.StatusNotFound {
		t.Errorf("deleting it twice: %d, want 404", status)
	}
}

// A reaction toggles, and a line in another channel is not one to react to.
func TestReactionsInAChannel(t *testing.T) {
	w := channelSetup(t)
	line := w.say(t, "bob", w.open, "PR today")
	react := func(who, channel string) (int, map[string]any) {
		return post(t, w.mux, who, "/api/channels/"+channel+"/chat/reactions", fmt.Sprintf(`{"messageId":%q,"emoji":"🔥"}`, line))
	}
	if status, body := react("cara", w.open); status != http.StatusOK || body["count"] != float64(1) || body["added"] != true {
		t.Fatalf("first reaction: %d %v", status, body)
	}
	if status, body := react("cara", w.open); status != http.StatusOK || body["count"] != float64(0) || body["added"] != false {
		t.Errorf("toggling it off: %d %v", status, body)
	}
	if status, _ := react("bob", w.private); status != http.StatusNotFound {
		t.Errorf("reacting through another channel: %d, want 404", status)
	}
}

// The announcement (ADR-0057 as amended by ADR-0058): marked by the crew's
// owner or an admin, drawn on its channel, led with on the crew's Board —
// and the Board reads only channels the rider may enter.
func TestAnnouncementIsAChannelsMarkedLine(t *testing.T) {
	w := channelSetup(t)
	openLine := w.say(t, "bob", w.open, "Saturday is the long one")
	privateLine := w.say(t, "bob", w.private, "coaches meet at six")
	mark := func(who, channel, line string) int {
		t.Helper()
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, "/api/channels/"+channel+"/announcement",
			strings.NewReader(fmt.Sprintf(`{"messageId":%q}`, line)))
		req.Header.Set("X-Test-User", who)
		rec := httptest.NewRecorder()
		w.mux.ServeHTTP(rec, req)
		return rec.Code
	}
	if status := mark("bob", w.open, openLine); status != http.StatusForbidden {
		t.Errorf("a member marked an announcement: %d, want 403", status)
	}
	if status := mark("alice", w.open, privateLine); status != http.StatusNotFound {
		t.Errorf("marking another channel's line: %d, want 404", status)
	}
	if status := mark("alice", w.open, openLine); status != http.StatusOK {
		t.Fatalf("the owner marking a line: %d", status)
	}
	if status := mark("alice", w.private, privateLine); status != http.StatusOK {
		t.Fatalf("the owner marking the private line: %d", status)
	}
	_, body := w.chat(t, "cara", w.open)
	if put, _ := body["announcement"].(map[string]any); put["text"] != "Saturday is the long one" {
		t.Errorf("the channel's own announcement: %v", body["announcement"])
	}
	board := func(who string) string {
		t.Helper()
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/crews/"+store.UUIDString(w.crew)+"/announcement", nil)
		req.Header.Set("X-Test-User", who)
		rec := httptest.NewRecorder()
		w.mux.ServeHTTP(rec, req)
		var put map[string]any
		_ = json.NewDecoder(rec.Body).Decode(&put)
		return fmt.Sprint(put["text"])
	}
	// The private line is the newer one: bob, named into it, is led with it;
	// cara, who is not, is led with the newest she may read.
	if got := board("bob"); got != "coaches meet at six" {
		t.Errorf("bob's Board leads with %q", got)
	}
	if got := board("cara"); got != "Saturday is the long one" {
		t.Errorf("cara's Board leads with %q, which must not be the private channel's", got)
	}
}

// The 500-line bound per channel keeps the channel's announcement however old.
func TestTheChannelPruneKeepsTheAnnouncement(t *testing.T) {
	w := channelSetup(t)
	oldest := w.say(t, "bob", w.open, "the notice")
	id, _ := store.ParseUUID(oldest)
	channel, _ := store.ParseUUID(w.open)
	if _, err := w.svc.store.Pool.Exec(t.Context(),
		`insert into chat_messages (channel_id, user_id, text, created_at)
		 select $1, $2, 'filler', now() + make_interval(secs => g) from generate_series(1, 510) g`,
		channel, w.users.ByToken["bob"].ID); err != nil {
		t.Fatalf("filler: %v", err)
	}
	if _, err := w.svc.store.Queries.SetChannelAnnouncement(t.Context(), db.SetChannelAnnouncementParams{ChannelID: channel, MessageID: id}); err != nil {
		t.Fatalf("mark: %v", err)
	}
	if err := w.svc.store.Queries.PruneChannelChat(t.Context(), channel); err != nil {
		t.Fatalf("prune: %v", err)
	}
	var left int
	var kept bool
	if err := w.svc.store.Pool.QueryRow(t.Context(),
		`select count(*), bool_or(id = $2) from chat_messages where channel_id = $1`, channel, id).Scan(&left, &kept); err != nil {
		t.Fatalf("count: %v", err)
	}
	if left != 501 || !kept {
		t.Errorf("after the prune: %d lines, announcement kept %v; want 501 and true", left, kept)
	}
}
