package rooms

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

type fixedWhere map[string]string

func (f fixedWhere) WhereIs(ids []string) map[string]string {
	out := map[string]string{}
	for _, id := range ids {
		if where, ok := f[id]; ok {
			out[id] = where
		}
	}
	return out
}
func (fixedWhere) Riding([]string) map[string]bool { return nil }
func (fixedWhere) PresenceChanged()                {}

// The hub names voice channels (#2436); the friends panel and the rider page
// still link to rooms. A channel no room became is online-in-no-room, never
// a guess at a room.
func TestRoomWhereNamesTheRoom(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Where Room")
	where := RoomWhere{Live: fixedWhere{
		"kim":  h.voiceOf(t, slug),
		"lena": "0b6c1f3e-0000-4000-8000-00000000000f",
		"max":  "",
	}, Store: h.store}.WhereIs([]string{"kim", "lena", "max", "nobody"})
	want := map[string]string{"kim": slug, "lena": "", "max": ""}
	if len(where) != len(want) {
		t.Fatalf("where = %v, want %v", where, want)
	}
	for id, slug := range want {
		if got, ok := where[id]; !ok || got != slug {
			t.Errorf("%s: %q (present %v), want %q", id, got, ok, slug)
		}
	}
}

// throughTheSlugDoor is the channel id the legacy room door hands on for who.
func (h *harness) throughTheSlugDoor(t *testing.T, who, slug string) string {
	t.Helper()
	got := "unset"
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/ws/rooms/"+slug, nil)
	req.SetPathValue("slug", slug)
	req.Header.Set("X-Test-User", who)
	h.svc.ByRoomSlug(func(_ http.ResponseWriter, r *http.Request) { got = r.PathValue("id") })(httptest.NewRecorder(), req)
	return got
}

// A room link's live doors hand over to the channel's own door.
func TestByRoomSlugHandsOverTheVoiceChannel(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Door Room")
	var got string
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.svc.ByRoomSlug(func(_ http.ResponseWriter, r *http.Request) {
		got = r.PathValue("id")
	}))
	for path, want := range map[string]string{
		"/ws/rooms/" + slug:     h.voiceOf(t, slug),
		"/ws/rooms/no-such-one": "",
	} {
		got = "unset"
		mux.ServeHTTP(httptest.NewRecorder(), httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil))
		if got != want {
			t.Errorf("%s handed over %q, want %q", path, got, want)
		}
	}
}
