package store_test

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The invariants #1106 says the cutover must not break, over the FOUR
// person-visibility queries that now go through `visible_rooms`. Table-driven
// over the query list on purpose: a spot check on one of them is what let
// #1109 and #1114 sit in the other three.
//
// Not in this table, and deliberately: `RoomWeekBoard` lists a room's actual
// members rather than everyone who may see it, and `ExportUserRooms` returns
// the caller's own rows and has no viewer to widen. #1106's body groups all
// four as one kind; they are not.

// visibilityQueries is every query that answers "may this viewer see this
// rider". Each returns whether anything came back for the pair.
var visibilityQueries = []struct {
	name string
	run  func(t *testing.T, f *crewFixture, viewer, rider pgtype.UUID) bool
}{
	{"ListRoomsInCommon", func(t *testing.T, f *crewFixture, viewer, rider pgtype.UUID) bool {
		rows, err := f.st.Queries.ListRoomsInCommon(t.Context(), db.ListRoomsInCommonParams{Viewer: viewer, Rider: rider})
		if err != nil {
			t.Fatalf("ListRoomsInCommon: %v", err)
		}
		return len(rows) > 0
	}},
	{"SharesRoomOrFriends", func(t *testing.T, f *crewFixture, viewer, rider pgtype.UUID) bool {
		ok, err := f.st.Queries.SharesRoomOrFriends(t.Context(), db.SharesRoomOrFriendsParams{Viewer: viewer, Rider: rider})
		if err != nil {
			t.Fatalf("SharesRoomOrFriends: %v", err)
		}
		return ok
	}},
	{"CountRiderMedalsInCommon", func(t *testing.T, f *crewFixture, viewer, rider pgtype.UUID) bool {
		// Returns rows only when a medal exists; the point under test is that
		// it does not error and honours the same boundary, so an empty result
		// on a medal-less fixture is the expected shape either way.
		_, err := f.st.Queries.CountRiderMedalsInCommon(t.Context(), db.CountRiderMedalsInCommonParams{Viewer: viewer, Rider: rider})
		if err != nil {
			t.Fatalf("CountRiderMedalsInCommon: %v", err)
		}
		return true
	}},
}

// Nobody sees across a crew boundary. carol is in her own crew; bob is in
// alice's. Neither may see the other, through any of the queries.
func TestNoVisibilityAcrossTheCrewBoundary(t *testing.T) {
	f := setupCrew(t)
	for _, q := range visibilityQueries {
		if q.name == "CountRiderMedalsInCommon" {
			continue // no medals in this fixture; covered by the no-error path above
		}
		if q.run(t, f, f.carol, f.bob) {
			t.Errorf("%s: carol sees bob across the crew boundary", q.name)
		}
		if q.run(t, f, f.bob, f.carol) {
			t.Errorf("%s: bob sees carol across the crew boundary", q.name)
		}
	}
}

// Sharing a room is what grants it, and it must still grant it — the failure
// mode of tightening a visibility join is a silent lockout, not an error.
func TestSharingARoomStillGrantsVisibility(t *testing.T) {
	f := setupCrew(t)
	for _, q := range visibilityQueries {
		if !q.run(t, f, f.bob, f.alice) {
			t.Errorf("%s: bob and alice share the open room and cannot see each other", q.name)
		}
	}
}

// A crew ban is the level a room ban cannot express, and it must reach these
// joins too — which it does only because they go through the view.
func TestACrewBanEndsVisibility(t *testing.T) {
	f := setupCrew(t)
	if !visibilityQueries[0].run(t, f, f.bob, f.alice) {
		t.Fatal("bob could not see alice before the ban — test proves nothing")
	}
	if err := f.st.Queries.SetCrewRole(t.Context(), db.SetCrewRoleParams{
		CrewID: f.crew, UserID: f.bob, Role: "banned",
	}); err != nil {
		t.Fatalf("crew ban: %v", err)
	}
	for _, q := range visibilityQueries {
		if q.name == "CountRiderMedalsInCommon" {
			continue
		}
		if q.run(t, f, f.bob, f.alice) {
			t.Errorf("%s: a crew-banned rider still sees the people they were banned from", q.name)
		}
		if q.run(t, f, f.alice, f.bob) {
			t.Errorf("%s: the room still sees a crew-banned rider", q.name)
		}
	}
}

// A room ban already did this before the crew existed. It must still, and this
// is the case a careless rewrite through the view would drop.
func TestARoomBanStillEndsVisibility(t *testing.T) {
	f := setupCrew(t)
	if !visibilityQueries[0].run(t, f, f.bob, f.alice) {
		t.Fatal("bob could not see alice before the ban — test proves nothing")
	}
	f.setRole(t, f.openRoom, f.bob, "banned")
	for _, q := range visibilityQueries {
		if q.name == "CountRiderMedalsInCommon" {
			continue
		}
		if q.run(t, f, f.bob, f.alice) {
			t.Errorf("%s: a room-banned rider still sees the room's people", q.name)
		}
	}
}

// The widening ADR-0038 intends, and its limit. Being PERMITTED into the same
// room is what grants visibility — not joining it, and not merely sharing a
// crew. This test asserted the wrong thing first and the code was right: dave
// joining the PRIVATE room makes him a crew member, and the open room is
// crew-visible, so he can see it and therefore shares it with bob. That is the
// widening, reached without dave joining the open room at all.
func TestCrewVisibilityGrantsThroughARoomNobodyJoined(t *testing.T) {
	f := setupCrew(t)
	dave := f.user(t, "dave")
	f.join(t, f.private, dave, "member")

	if !visibilityQueries[0].run(t, f, f.bob, dave) {
		t.Error("crew visibility did not widen: dave and bob both may enter the open room")
	}
}

// The limit: take the crew visibility away and the widening goes with it.
// dave and bob then share no room either may enter — dave is in the private
// room, bob in the closed one — even though they are in the same crew.
// This is ADR-0038's "joining a crew does not by itself expose everyone".
func TestACrewAloneGrantsNothingWithoutASharedRoom(t *testing.T) {
	f := setupCrew(t)
	dave := f.user(t, "dave")
	f.join(t, f.private, dave, "member")

	if _, err := f.st.Pool.Exec(t.Context(),
		"update rooms set crew_visible = false where id = $1", f.openRoom); err != nil {
		t.Fatalf("close the room: %v", err)
	}
	for _, q := range visibilityQueries {
		if q.name == "CountRiderMedalsInCommon" {
			continue
		}
		if q.run(t, f, f.bob, dave) {
			t.Errorf("%s: crew membership alone exposed two riders who share no room", q.name)
		}
	}
}
