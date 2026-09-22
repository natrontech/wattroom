package channels

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/av"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func (h *harness) authorize(t *testing.T, who, id string) (protocol.Rider, string, error) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/ws/channels/"+id, nil)
	if who != "" {
		req.Header.Set("X-Test-User", who)
	}
	return h.svc.Authorize(req, id)
}

// The live door asks mayEnter like every other door (#2436): the hub's socket
// and the LiveKit token both stand behind it.
func TestAuthorizeIsTheGate(t *testing.T) {
	h := setup(t)
	open := h.create(t, "voice", "Pain Cave", false)
	private := h.create(t, "voice", "Coaches", true)
	text := h.create(t, "text", "general", false)

	for _, c := range []struct {
		who, id, role string
		err           error
	}{
		{"alice", open, "owner", nil},
		{"dave", private, "admin", nil},
		{"bob", open, "member", nil},
		{"bob", private, "", av.ErrNotMember},
		{"erin", open, "", av.ErrNotMember},
		{"carol", open, "", av.ErrNotMember},
		{"alice", text, "", av.ErrNotMember},
		{"alice", "not-a-uuid", "", av.ErrNotMember},
		{"", open, "", av.ErrNoSession},
	} {
		rider, canonical, err := h.authorize(t, c.who, c.id)
		if !errors.Is(err, c.err) {
			t.Errorf("%s into %s: err %v, want %v", c.who, c.id, err, c.err)
			continue
		}
		if c.err == nil && (rider.Role != c.role || canonical != c.id) {
			t.Errorf("%s into %s: role %q canonical %q, want %q and the id", c.who, c.id, rider.Role, canonical, c.role)
		}
	}

	// Named in, bob enters; and any casing of the id is the same channel.
	if status, _ := h.call(t, "alice", http.MethodPut,
		"/api/channels/"+private+"/members/"+store.UUIDString(h.users.ByToken["bob"].ID), ""); status != http.StatusNoContent {
		t.Fatalf("name bob: %d", status)
	}
	if _, canonical, err := h.authorize(t, "bob", strings.ToUpper(private)); err != nil || canonical != private {
		t.Errorf("bob named in, upper-cased id: canonical %q err %v, want %q", canonical, err, private)
	}
}

type fakeLive struct {
	mu      sync.Mutex
	kicked  []string
	closed  []string
	present map[string]protocol.RoomPresence
	running map[string]protocol.LiveSession
}

func (f *fakeLive) LiveSession(channel string) (protocol.LiveSession, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	live, ok := f.running[channel]
	return live, ok
}

func (f *fakeLive) PresenceChanged() {}

func (f *fakeLive) Presence(channel string) protocol.RoomPresence {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.present[channel]
}

func (f *fakeLive) Kick(channel, userID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.kicked = append(f.kicked, channel+"/"+userID)
}

func (f *fakeLive) CloseRoom(channel string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = append(f.closed, channel)
}

// Taken out of a private voice channel is taken out of its call — unless the
// crew role still admits them (#2436, the handoff from #2434).
func TestUnnamingSeversTheCall(t *testing.T) {
	h := setup(t)
	live := &fakeLive{}
	h.svc.SetLive(live)
	private := h.create(t, "voice", "Coaches", true)
	bob := store.UUIDString(h.users.ByToken["bob"].ID)
	dave := store.UUIDString(h.users.ByToken["dave"].ID)
	for _, who := range []string{bob, dave} {
		if status, _ := h.call(t, "alice", http.MethodPut, "/api/channels/"+private+"/members/"+who, ""); status != http.StatusNoContent {
			t.Fatalf("name %s: %d", who, status)
		}
		if status, _ := h.call(t, "alice", http.MethodDelete, "/api/channels/"+private+"/members/"+who, ""); status != http.StatusNoContent {
			t.Fatalf("unname %s: %d", who, status)
		}
	}
	if want := []string{private + "/" + bob}; !slices.Equal(live.kicked, want) {
		t.Errorf("kicked %v, want only the member %v — the admin still enters by role", live.kicked, want)
	}
}

func TestVoiceRowsSayWhoIsIn(t *testing.T) {
	h := setup(t)
	live := &fakeLive{}
	h.svc.SetLive(live)
	voice := h.create(t, "voice", "Pain Cave", false)
	h.create(t, "text", "general", false)
	live.present = map[string]protocol.RoomPresence{voice: {Connected: 1, Riders: []string{"alice"}, Voice: []string{"alice"}}}

	rows := h.listed(t, "bob")
	presence, ok := rows["Pain Cave"]["presence"].(map[string]any)
	if !ok || presence["connected"] != float64(1) {
		t.Errorf("the voice row's presence reads %v, want one rider in it", rows["Pain Cave"]["presence"])
	}
	if rows["general"]["presence"] != nil {
		t.Errorf("a text channel carries presence: %v", rows["general"]["presence"])
	}
}

func TestDeletingAVoiceChannelForgetsItsLiveState(t *testing.T) {
	h := setup(t)
	live := &fakeLive{}
	h.svc.SetLive(live)
	voice := h.create(t, "voice", "Pain Cave", false)
	text := h.create(t, "text", "general", false)
	for _, id := range []string{voice, text} {
		if status, _ := h.call(t, "alice", http.MethodDelete, "/api/channels/"+id, ""); status != http.StatusNoContent {
			t.Fatalf("delete %s: %d", id, status)
		}
	}
	if want := []string{voice}; !slices.Equal(live.closed, want) {
		t.Errorf("closed %v, want the voice channel only %v", live.closed, want)
	}
}

// The roster carries the level (#690): the door is where a socket's rider is
// built, and the strip's rings have no other source for it.
func TestAuthorizeCarriesTheRidersLevel(t *testing.T) {
	h := setup(t)
	voice := h.create(t, "voice", "Ring Room", false)
	if _, err := h.store.Queries.AddXpEvent(t.Context(), db.AddXpEventParams{
		UserID: h.users.ByToken["alice"].ID, Source: "lounge", Amount: 240, Ref: "roster-test-" + voice,
		At: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}); err != nil {
		t.Fatalf("xp event: %v", err)
	}
	rider, _, err := h.authorize(t, "alice", voice)
	if err != nil || rider.TotalXp != 240 {
		t.Fatalf("rider.TotalXp = %d (err %v), want 240 — the roster cannot ring without it", rider.TotalXp, err)
	}
}
