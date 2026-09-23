package crews

import (
	"net/http"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

// An old /r/{slug} link lands where its room went (#2446, #2458): the crew,
// and the text and voice channel the room became. The row is written straight
// into moved_rooms (#2558) — nothing makes a room any more, and the migration
// that filled that table is the fixture here.
func TestAnOldRoomLinkNamesWhereTheRoomWent(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Moved Crew")
	text := h.channel(t, crew, "text", "Old Room", false)
	voice := h.channel(t, crew, "voice", "Old Room", false)

	slug := "old-room-" + strings.ToLower(randomCode(8))
	if _, err := h.store.Pool.Exec(t.Context(),
		"insert into moved_rooms (slug, crew_id, text_channel_id, voice_channel_id) values ($1, $2, $3, $4)",
		slug, crew.ID, text, voice); err != nil {
		t.Fatalf("moved room: %v", err)
	}

	for _, tc := range []struct{ name, path string }{
		{"as written", "/api/moved/r/" + slug},
		// A link typed out by hand, or shouted across the room.
		{"in another case", "/api/moved/r/" + strings.ToUpper(slug)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, body := h.call(t, "bob", http.MethodGet, tc.path, "")
			if status != http.StatusOK {
				t.Fatalf("%d %v", status, body)
			}
			want := map[string]any{
				"crewId":         store.UUIDString(crew.ID),
				"textChannelId":  store.UUIDString(text),
				"voiceChannelId": store.UUIDString(voice),
			}
			if len(body) != len(want) {
				t.Errorf("the answer carries %v, want exactly %v", body, want)
			}
			for key, id := range want {
				if body[key] != id {
					t.Errorf("%s = %v, want %v", key, body[key], id)
				}
			}
		})
	}

	status, body := h.call(t, "bob", http.MethodGet, "/api/moved/r/no-room-lived-here", "")
	if status != http.StatusNotFound || body["error"] != "not_found" {
		t.Errorf("an unknown slug: %d %v, want 404 not_found", status, body)
	}
	// Signed out is refused before the lookup, so the answer is the same
	// whether the room ever existed.
	for _, path := range []string{"/api/moved/r/" + slug, "/api/moved/r/no-room-lived-here"} {
		if status, body := h.call(t, "", http.MethodGet, path, ""); status != http.StatusUnauthorized || body["crewId"] != nil {
			t.Errorf("signed out %s: %d %v, want 401 and no crew", path, status, body)
		}
	}
}
