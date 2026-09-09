package store_test

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The `visible_rooms` view is the single expression every gate and visibility
// join will go through (ADR-0038, third amendment). Its correctness argument
// lives here rather than being re-argued in each of the eight call sites
// #1106 repoints — which is the whole reason it is a view. #1109 and #1114
// were four joins that each wrote the guard out by hand and one of them
// omitted it; that class cannot recur through a relation.
//
// Every case below is a SILENT failure if it breaks: the view returns a row
// too many (a privacy leak) or one too few (a lockout). Neither errors.

var roomSeq atomic.Int64

type crewFixture struct {
	st                           *store.Store
	alice, bob, carol            pgtype.UUID
	crew                         pgtype.UUID
	openRoom, private, elsewhere pgtype.UUID
}

func (f *crewFixture) canEnter(t *testing.T, user, room pgtype.UUID) bool {
	t.Helper()
	ok, err := f.st.Queries.CanEnterRoom(t.Context(), db.CanEnterRoomParams{UserID: user, RoomID: room})
	if err != nil {
		t.Fatalf("CanEnterRoom: %v", err)
	}
	return ok
}

func (f *crewFixture) user(t *testing.T, name string) pgtype.UUID {
	t.Helper()
	u, err := f.st.Queries.CreateUser(t.Context(), db.CreateUserParams{
		DisplayName: name, FtpWatts: 200, WeightKg: 75,
	})
	if err != nil {
		t.Fatalf("create user %s: %v", name, err)
	}
	t.Cleanup(func() {
		_, _ = f.st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
	})
	return u.ID
}

// rooms.code is unique across the WHOLE test database, which every package
// shares. The "VR" prefix keeps these clear of the other harnesses' codes —
// playlists derives its own from the owner's initial (alice -> "A00001"), and
// an earlier version of this helper generated exactly that and collided.
func (f *crewFixture) room(t *testing.T, slug string, owner pgtype.UUID, crew pgtype.UUID, crewVisible bool) pgtype.UUID {
	t.Helper()
	n := roomSeq.Add(1) % 10000
	r, err := f.st.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Slug:    fmt.Sprintf("%s-%d", slug, n),
		Name:    slug,
		OwnerID: owner,
	})
	if err != nil {
		t.Fatalf("create room %s: %v", slug, err)
	}
	t.Cleanup(func() {
		_, _ = f.st.Pool.Exec(context.Background(), "delete from rooms where id = $1", r.ID)
	})
	if _, err := f.st.Pool.Exec(t.Context(),
		"update rooms set crew_id = $2, crew_visible = $3 where id = $1", r.ID, crew, crewVisible); err != nil {
		t.Fatalf("place room %s in crew: %v", slug, err)
	}
	f.join(t, r.ID, owner, "owner")
	return r.ID
}

func (f *crewFixture) join(t *testing.T, room, user pgtype.UUID, role string) {
	t.Helper()
	if err := f.st.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
		RoomID: room, UserID: user, Role: role,
	}); err != nil {
		t.Fatalf("membership: %v", err)
	}
	// Crew membership is a row since #1236, written by the crew's door
	// before any room's; the fixture writes it too, except for the crew's
	// owner, who holds no row (#1212).
	if _, err := f.st.Pool.Exec(t.Context(), `
		insert into crew_roles (crew_id, user_id, role)
		select r.crew_id, $2, 'member' from rooms r join crews c on c.id = r.crew_id
		where r.id = $1 and c.owner_id <> $2
		on conflict do nothing`, room, user); err != nil {
		t.Fatalf("crew membership: %v", err)
	}
}

func (f *crewFixture) setRole(t *testing.T, room, user pgtype.UUID, role string) {
	t.Helper()
	if err := f.st.Queries.UpdateMembershipRole(t.Context(), db.UpdateMembershipRoleParams{
		RoomID: room, UserID: user, Role: role,
	}); err != nil {
		t.Fatalf("set role: %v", err)
	}
}

// alice owns a crew with two rooms — one open to the crew, one private. bob is
// a member of the open room only, and in the crew by the row the fixture's
// join writes alongside (#1236). carol is in a room in a different crew.
func setupCrew(t *testing.T) *crewFixture {
	t.Helper()
	f := &crewFixture{st: open(t)}
	f.alice = f.user(t, "alice")
	f.bob = f.user(t, "bob")
	f.carol = f.user(t, "carol")

	crew, err := f.st.Queries.CreateCrew(t.Context(), db.CreateCrewParams{Name: "Velvet", OwnerID: f.alice})
	if err != nil {
		t.Fatalf("create crew: %v", err)
	}
	f.crew = crew.ID
	t.Cleanup(func() {
		_, _ = f.st.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID)
	})

	other, err := f.st.Queries.CreateCrew(t.Context(), db.CreateCrewParams{Name: "Other", OwnerID: f.carol})
	if err != nil {
		t.Fatalf("create other crew: %v", err)
	}
	t.Cleanup(func() {
		_, _ = f.st.Pool.Exec(context.Background(), "delete from crews where id = $1", other.ID)
	})

	f.openRoom = f.room(t, "open", f.alice, f.crew, true)
	f.private = f.room(t, "priv", f.alice, f.crew, false)
	f.elsewhere = f.room(t, "else", f.carol, other.ID, true)
	f.join(t, f.openRoom, f.bob, "member")
	return f
}

func TestVisibleRooms(t *testing.T) {
	f := setupCrew(t)

	for _, tc := range []struct {
		name string
		user pgtype.UUID
		room pgtype.UUID
		want bool
	}{
		{"a member sees the room they joined", f.bob, f.openRoom, true},
		{"the owner sees their own private room", f.alice, f.private, true},
		{"a crew-mate sees a room open to the crew", f.bob, f.openRoom, true},
		{"a crew-mate does NOT see a private room in that crew", f.bob, f.private, false},
		{"a stranger sees nothing of another crew", f.bob, f.elsewhere, false},
		{"nobody crosses the crew boundary inwards", f.carol, f.openRoom, false},
	} {
		if got := f.canEnter(t, tc.user, tc.room); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

// A grant is the "named exceptions" half of a private room: someone let in who
// is neither a member nor able to see it through their crew.
func TestAGrantOpensOnePrivateRoomAndNothingElse(t *testing.T) {
	f := setupCrew(t)
	if f.canEnter(t, f.bob, f.private) {
		t.Fatal("bob saw the private room before the grant — test proves nothing")
	}
	if err := f.st.Queries.GrantRoomAccess(t.Context(), db.GrantRoomAccessParams{RoomID: f.private, UserID: f.bob}); err != nil {
		t.Fatalf("grant: %v", err)
	}
	if !f.canEnter(t, f.bob, f.private) {
		t.Error("a granted rider still cannot enter")
	}
	if f.canEnter(t, f.carol, f.private) {
		t.Error("granting bob opened the room to carol")
	}
}

// A ban must beat every path that would otherwise grant the room, which is why
// both exclusions are applied after the union rather than per branch.
func TestARoomBanBeatsMembershipAndGrant(t *testing.T) {
	f := setupCrew(t)
	if err := f.st.Queries.GrantRoomAccess(t.Context(), db.GrantRoomAccessParams{RoomID: f.openRoom, UserID: f.bob}); err != nil {
		t.Fatalf("grant: %v", err)
	}
	if !f.canEnter(t, f.bob, f.openRoom) {
		t.Fatal("bob could not enter before the ban — test proves nothing")
	}
	f.setRole(t, f.openRoom, f.bob, "banned")
	if f.canEnter(t, f.bob, f.openRoom) {
		t.Error("a room ban did not beat a membership plus a grant")
	}
}

// The level a room ban cannot express (ADR-0038, third amendment): out of
// EVERY room in the crew, including ones a membership or a grant allows.
func TestACrewBanClearsEveryRoomInThatCrew(t *testing.T) {
	f := setupCrew(t)
	if err := f.st.Queries.GrantRoomAccess(t.Context(), db.GrantRoomAccessParams{RoomID: f.private, UserID: f.bob}); err != nil {
		t.Fatalf("grant: %v", err)
	}
	if !f.canEnter(t, f.bob, f.openRoom) || !f.canEnter(t, f.bob, f.private) {
		t.Fatal("bob could not reach both rooms before the crew ban — test proves nothing")
	}

	if err := f.st.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: f.crew, UserID: f.bob, Role: "banned",
	}); err != nil {
		t.Fatalf("crew ban: %v", err)
	}

	if f.canEnter(t, f.bob, f.openRoom) {
		t.Error("a crew ban left the open room reachable through membership")
	}
	if f.canEnter(t, f.bob, f.private) {
		t.Error("a crew ban left a private room reachable through a grant")
	}
	// Alice is not banned and must be untouched — a crew ban is one person.
	if !f.canEnter(t, f.alice, f.openRoom) {
		t.Error("banning bob cost alice her own crew's room")
	}
}

// Lifting one ban must not lift the other: separate decisions by separate
// people, and the tempting implementation makes one cascade (ADR-0038).
func TestLiftingACrewBanDoesNotLiftARoomBan(t *testing.T) {
	f := setupCrew(t)
	f.setRole(t, f.openRoom, f.bob, "banned")
	if err := f.st.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: f.crew, UserID: f.bob, Role: "banned",
	}); err != nil {
		t.Fatalf("crew ban: %v", err)
	}
	if err := f.st.Queries.ClearCrewRole(t.Context(), db.ClearCrewRoleParams{
		CrewID: f.crew, UserID: f.bob,
	}); err != nil {
		t.Fatalf("clear crew ban: %v", err)
	}
	if f.canEnter(t, f.bob, f.openRoom) {
		t.Error("clearing the crew ban readmitted someone the room owner banned")
	}
}
