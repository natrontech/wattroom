package crews

import (
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/channels"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// liveRecorder is the hub as the channels' gate drives it (#2808): the
// re-roles it was asked for, and the sockets it severed.
type liveRecorder struct{ roles, kicked []string }

func (l *liveRecorder) SetRole(channel, userID, role string) {
	l.roles = append(l.roles, channel+"/"+userID+"/"+role)
}

func (l *liveRecorder) Kick(channel, userID string) {
	l.kicked = append(l.kicked, channel+"/"+userID)
}

func (*liveRecorder) Occupants(string) []string { return nil }

func (*liveRecorder) PresenceChanged() {}

func (*liveRecorder) Presence(string) protocol.ChannelPresence { return protocol.ChannelPresence{} }

func (*liveRecorder) LiveSession(string) (protocol.LiveSession, bool) {
	return protocol.LiveSession{}, false
}

func (*liveRecorder) Move(string, string, protocol.Moved) error { return nil }

func (*liveRecorder) CloseRoom(string) {}

// gate puts the real channels' gate in front of a recording hub, so what a
// crew handler asks is answered by mayEnter over the rows it just wrote.
func (h *harness) gate() *liveRecorder {
	live := &liveRecorder{}
	g := channels.New(h.store, h.users, slog.New(slog.DiscardHandler))
	g.SetLive(live)
	h.svc.SetGate(g)
	return live
}

// at is one rider at one channel as the recorder spells it, with a role when
// one is given.
func at(channel pgtype.UUID, rider string, role ...string) string {
	out := store.UUIDString(channel) + "/" + rider
	for _, r := range role {
		out += "/" + r
	}
	return out
}

// sameSet compares two recordings without caring for their order.
func sameSet(got, want []string) bool {
	got, want = slices.Clone(got), slices.Clone(want)
	slices.Sort(got)
	slices.Sort(want)
	return slices.Equal(got, want)
}

// setRole is alice, the owner, giving who a crew role through the API.
func (h *harness) setRole(t *testing.T, crew db.GetCrewRow, who, role string) {
	t.Helper()
	if status, body := h.call(t, "alice", http.MethodPost, crewPath(crew, "/role"),
		fmt.Sprintf(`{"userId":%q,"role":%q}`, h.userID(t, who), role)); status != http.StatusNoContent {
		t.Fatalf("make %s %s: %d %v", who, role, status, body)
	}
}

// The door reads the crew role once, at connect (#2436): a crew promotion
// re-roles the sockets already open in every voice channel of the crew, in
// the words the hub's controls read.
func TestACrewRoleReachesOpenSockets(t *testing.T) {
	h := setup(t)
	live := h.gate()
	crew := h.newCrew(t, "alice", "Role Crew")
	lounge := h.voice(t, crew)
	second := h.channel(t, crew, "voice", "Second", false)
	h.join(t, "bob", crew)
	bob := h.userID(t, "bob")
	h.setRole(t, crew, "bob", "admin")
	// The crew's word for it (#2438): coach is the session's, not a role.
	if want := []string{at(lounge, bob, "admin"), at(second, bob, "admin")}; !sameSet(live.roles, want) {
		t.Errorf("re-roled %v, want %v", live.roles, want)
	}
	if len(live.kicked) != 0 {
		t.Errorf("a promotion severed %v", live.kicked)
	}
}

// An admin demoted to member leaves, on the spot, the private voice channels
// that do not name them (#2808). Before, the socket they already held kept
// every tick there until they happened to disconnect. The channels that still
// admit them keep them, as a member.
func TestADemotedAdminLeavesThePrivateChannelsThatDoNotNameThem(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Demotion Crew")
	lounge := h.voice(t, crew)
	coaches := h.channel(t, crew, "voice", "Coaches", true)
	named := h.channel(t, crew, "voice", "Named", true)
	h.join(t, "bob", crew)
	h.makeCrewAdmin(t, crew, "bob")
	h.nameInto(t, named, "bob")
	live := h.gate()
	bob := h.userID(t, "bob")

	h.setRole(t, crew, "bob", "member")

	if want := []string{at(coaches, bob)}; !slices.Equal(live.kicked, want) {
		t.Errorf("severed %v, want only the private channel that does not name him %v", live.kicked, want)
	}
	if want := []string{at(lounge, bob, "member"), at(named, bob, "member")}; !sameSet(live.roles, want) {
		t.Errorf("re-roled %v, want %v", live.roles, want)
	}
}

// A hand-over moves two roles, and the sockets already open carry both
// (#2808): a plain member who inherits the crew may end another rider's
// session without reconnecting (the #278 shape), and the old owner's roster
// entry reads admin.
func TestAHandOverReachesOpenSockets(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Handover Sockets")
	lounge := h.voice(t, crew)
	h.join(t, "bob", crew)
	live := h.gate()
	alice, bob := h.userID(t, "alice"), h.userID(t, "bob")

	if status, body := h.call(t, "alice", http.MethodPost, crewPath(crew, "/transfer"),
		fmt.Sprintf(`{"userId":%q}`, bob)); status != http.StatusOK {
		t.Fatalf("hand-over: %d %v", status, body)
	}
	if want := []string{at(lounge, bob, "owner"), at(lounge, alice, "admin")}; !sameSet(live.roles, want) {
		t.Errorf("re-roled %v, want %v", live.roles, want)
	}
	if len(live.kicked) != 0 {
		t.Errorf("a hand-over severed %v", live.kicked)
	}
}

// The purge's successor takes the crew on the sockets already open too
// (#2808), and only once the purge has committed: the transaction can still
// roll back, and a socket re-roled is not un-roled by a rollback.
func TestASuccessorsOpenSocketsTakeTheCrew(t *testing.T) {
	h := setup(t)
	crew := h.newCrew(t, "alice", "Successor Sockets")
	lounge := h.voice(t, crew)
	h.join(t, "bob", crew)
	live := h.gate()

	handedOn, err := h.svc.ReleaseCrews(t.Context(), h.store.Queries, h.users.ByToken["alice"].ID)
	if err != nil {
		t.Fatalf("release: %v", err)
	}
	if len(live.roles) != 0 {
		t.Fatalf("re-roled %v inside the purge, before it committed", live.roles)
	}
	handedOn(t.Context())
	if want := []string{at(lounge, h.userID(t, "bob"), "owner")}; !slices.Equal(live.roles, want) {
		t.Errorf("re-roled %v, want %v", live.roles, want)
	}
}
