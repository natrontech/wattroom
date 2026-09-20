package store_test

import (
	"context"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

// The contract half of ADR-0038's fourth amendment (#1301) is a constraint on
// `rooms.crew_id`, and the thing that decides whether it can ship is not the
// production row count the issue was parked on — it is whether the INSERT
// that makes a room names the column at all. It did not: `CreateRoom` wrote
// (slug, name, owner_id) and `PlaceRoomInCrew` added the crew a statement
// later, inside the same transaction. Nobody outside that transaction could
// ever see the crew-less row, so nothing failed and nothing logged; the first
// symptom would have been every room creation refused by the release carrying
// the constraint, on a database with zero null rows.
//
// So the insert is run here against a `rooms` that already carries the
// constraint. A temp table of that name shadows the real one for this
// connection (pg_temp is searched first), so the check is real while the
// shared test database is untouched and unlocked, and the whole thing goes
// away with the rollback.
func TestRoomCreationNamesItsCrewInTheInsert(t *testing.T) {
	f := setupCrew(t)
	ctx := t.Context()

	conn, err := f.st.Pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer conn.Release()
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	if _, err := tx.Exec(ctx, `
		create temp table rooms (
			like public.rooms including defaults,
			constraint rooms_crew_id_present check (crew_id is not null)
		) on commit drop`); err != nil {
		t.Fatalf("shadow rooms: %v", err)
	}

	q := f.st.Queries.WithTx(tx)

	// A room the way the app makes one. This is the assertion: if the crew
	// arrives after the insert rather than in it, the constraint refuses the
	// insert and this is the release that cannot create rooms.
	if _, err := q.CreateRoom(ctx, db.CreateRoomParams{
		Slug: testx.Slug("crew-in-insert"), Name: "Crew in insert",
		OwnerID: f.alice, CrewID: f.crew, CrewVisible: true,
	}); err != nil {
		t.Fatalf("a room created the way the app creates one was refused by "+
			"`check (crew_id is not null)`, so the contract half of ADR-0038's "+
			"fourth amendment cannot ship: %v", err)
	}

	// And the shadow is doing work: a call that names no crew must be
	// refused, or the check above passes for the wrong reason.
	if _, err := q.CreateRoom(ctx, db.CreateRoomParams{
		Slug: testx.Slug("crewless"), Name: "Crewless", OwnerID: f.alice,
	}); err == nil {
		t.Fatal("a crew-less room was accepted — the shadow table carries no " +
			"constraint, so the case above proves nothing")
	}
}
