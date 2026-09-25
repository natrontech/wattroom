package channels

import (
	"net/http"
	"slices"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// fakeEjector is LiveKit's half of an eviction, remembered.
type fakeEjector struct{ ejected []string }

func (f *fakeEjector) Eject(channel, userID string) {
	f.ejected = append(f.ejected, channel+"/"+userID)
}

// A voice channel made private shuts out whoever it no longer admits, and the
// door is not the only way in: the sockets and the call already open are
// asked again (#2808). The owner, an admin and a member named in stay, on the
// role the gate answers. A member it does not name is evicted from both.
func TestMakingAChannelPrivateEvictsWhoItNoLongerAdmits(t *testing.T) {
	h := setup(t)
	live, call := &fakeLive{}, &fakeEjector{}
	h.svc.SetLive(live)
	h.svc.SetVoiceEjector(call)
	voice := h.create(t, "voice", "Pain Cave", false)
	channelID, _ := store.ParseUUID(voice)
	crewID, _ := store.ParseUUID(h.crew)
	id := func(who string) string { return store.UUIDString(h.users.ByToken[who].ID) }
	// carol joins as a plain member; bob is named in ahead of the flip.
	if err := h.store.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: crewID, UserID: h.users.ByToken["carol"].ID, Role: "member",
	}); err != nil {
		t.Fatalf("carol joins: %v", err)
	}
	if err := h.store.Queries.NameChannelMember(t.Context(), db.NameChannelMemberParams{
		ChannelID: channelID, UserID: h.users.ByToken["bob"].ID, AddedBy: h.users.ByToken["alice"].ID,
	}); err != nil {
		t.Fatalf("name bob: %v", err)
	}
	live.occupants = map[string][]string{voice: {id("alice"), id("bob"), id("carol"), id("dave")}}

	if status, body := h.call(t, "alice", http.MethodPatch, "/api/channels/"+voice, `{"private":true}`); status != http.StatusOK {
		t.Fatalf("make it private: %d %v", status, body)
	}
	if want := []string{voice + "/" + id("carol")}; !slices.Equal(live.kicked, want) || !slices.Equal(call.ejected, want) {
		t.Errorf("kicked %v, ejected %v; want only the member it does not name, from both: %v", live.kicked, call.ejected, want)
	}
	want := []string{voice + "/" + id("alice") + "/owner", voice + "/" + id("bob") + "/member", voice + "/" + id("dave") + "/admin"}
	slices.Sort(live.roles)
	slices.Sort(want)
	if !slices.Equal(live.roles, want) {
		t.Errorf("re-roled %v, want who it still admits %v", live.roles, want)
	}

	// Only a flip to private shuts anyone out: a rename of a channel already
	// private, or opening it again, asks nobody.
	live.kicked, live.roles = nil, nil
	for _, patch := range []string{`{"name":"Still Shut"}`, `{"private":false}`} {
		if status, body := h.call(t, "alice", http.MethodPatch, "/api/channels/"+voice, patch); status != http.StatusOK {
			t.Fatalf("patch %s: %d %v", patch, status, body)
		}
	}
	if len(live.kicked) != 0 || len(live.roles) != 0 {
		t.Errorf("a change that shut nobody out asked the gate again: kicked %v, re-roled %v", live.kicked, live.roles)
	}
}
