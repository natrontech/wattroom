package crews

import (
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// An old /r/{slug} link lands where its room went (#2446, #2458): the crew,
// and the text and voice channel the room became. The row is written straight
// into moved_rooms (#2558) — nothing makes a room any more, and the migration
// that filled that table is the fixture here.
// movedRoom records that an old room became these channels, and hands back
// its slug.
func (h *harness) movedRoom(t *testing.T, crew db.GetCrewRow, text, voice pgtype.UUID) string {
	t.Helper()
	slug := "old-room-" + strings.ToLower(randomCode(8))
	if _, err := h.store.Pool.Exec(t.Context(),
		"insert into moved_rooms (slug, crew_id, text_channel_id, voice_channel_id) values ($1, $2, $3, $4)",
		slug, crew.ID, text, voice); err != nil {
		t.Fatalf("moved room: %v", err)
	}
	return slug
}

func TestAnOldRoomLinkNamesWhereTheRoomWent(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Moved Crew")
	text := h.channel(t, crew, "text", "Old Room", false)
	voice := h.channel(t, crew, "voice", "Old Room", false)
	slug := h.movedRoom(t, crew, text, voice)
	h.join(t, "bob", crew)

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

// An old link hands out only the ids it would open (#2821): a channel id is
// the address of its activity, so a rider outside the crew or banned from it
// meets an unknown slug's 404, and a member is not told a private channel
// they are not named into.
func TestAnOldRoomLinkNamesOnlyWhatItWouldOpen(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Moved Crew")
	text := h.channel(t, crew, "text", "Old Room", true)
	voice := h.channel(t, crew, "voice", "Old Room", false)
	slug := h.movedRoom(t, crew, text, voice)
	h.join(t, "bob", crew)

	status, body := h.call(t, "bob", http.MethodGet, "/api/moved/r/"+slug, "")
	if status != http.StatusOK || body["crewId"] != store.UUIDString(crew.ID) ||
		body["voiceChannelId"] != store.UUIDString(voice) || body["textChannelId"] != nil {
		t.Errorf("a member not named into the text channel: %d %v, want the crew and the voice channel only", status, body)
	}
	if status, body := h.call(t, "carol", http.MethodGet, "/api/moved/r/"+slug, ""); status != http.StatusNotFound || body["crewId"] != nil {
		t.Errorf("outside the crew: %d %v, want 404 and no ids", status, body)
	}
	h.banFromCrew(t, crew, "bob")
	if status, body := h.call(t, "bob", http.MethodGet, "/api/moved/r/"+slug, ""); status != http.StatusNotFound || body["crewId"] != nil {
		t.Errorf("banned: %d %v, want 404 and no ids", status, body)
	}
}

// Old slugs circulate and can be walked, so following one spends a guess from
// the crew door's window (#2821, #1673).
func TestFollowingOldRoomLinksHasACeiling(t *testing.T) {
	h := setup(t)
	for i := range doorGuessesPerWindow {
		if status, _ := h.call(t, "carol", http.MethodGet, "/api/moved/r/no-room-lived-here", ""); status != http.StatusNotFound {
			t.Fatalf("guess %d: %d, want 404", i, status)
		}
	}
	if status, body := h.call(t, "carol", http.MethodGet, "/api/moved/r/no-room-lived-here", ""); status != http.StatusTooManyRequests || body["error"] != "rate_limited" {
		t.Fatalf("past the ceiling: %d %v, want 429 rate_limited", status, body)
	}
}
