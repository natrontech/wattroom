package routes

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

// WattRoom's own roads ride in any session, whole and as the loops they are
// (#4258): no route row, no hidden ends, no crew to ask — and no database
// read, so the attacher here has none.
func TestALibraryRoadRidesInASessionWhole(t *testing.T) {
	const coach = "5b0e6c1e-0000-4000-8000-000000000001"
	a := NewAttacher(nil, nil)
	for id, lib := range library {
		t.Run(lib.name, func(t *testing.T) {
			if lib.road.LengthM < 10_000 || len(lib.road.Heights) < 2 {
				t.Fatalf("the copy reads %v m and %d heights", lib.road.LengthM, len(lib.road.Heights))
			}
			attachedJSON, refusal, err := a.ForSession(t.Context(), coach, "any channel", workoutOn(id))
			if err != nil || refusal != "" {
				t.Fatalf("ForSession: %q, %v", refusal, err)
			}
			got, meta := roadIn(t, attachedJSON)
			if got.LengthM != lib.road.LengthM || meta.OriginM != 0 || !meta.Loop {
				t.Fatalf("the pick carries %v m from %v m, loop %v; want the whole %v m loop", got.LengthM, meta.OriginM, meta.Loop, lib.road.LengthM)
			}
			route, profile, refused, err := a.SessionRoute(t.Context(), coach, id, "any channel")
			if err != nil || refused != nil {
				t.Fatalf("SessionRoute: %v, %v", refused, err)
			}
			if route.LengthM != lib.road.LengthM || !route.Loop || route.GenName != lib.name || route.Hash == "" || len(profile.Heights) != len(lib.road.Heights) {
				t.Fatalf("the session rides %+v on %d heights", route, len(profile.Heights))
			}
			if row, err := a.CheckShared(t.Context(), workoutOn(id), pgtype.UUID{}, pgtype.UUID{}); err != nil || row.Valid {
				t.Fatalf("a plan on it keeps route %v (%v); want none", row, err)
			}
			if name, err := a.SharedName(t.Context(), workoutOn(id), "renamed"); err != nil || name != lib.name {
				t.Fatalf("it goes out as %q (%v), want %q", name, err, lib.name)
			}
			at, err := a.CrewRoute(t.Context(), workoutOn(id))
			if err != nil || at == nil || at.ID != id || at.FromM != 0 || !at.Loop {
				t.Fatalf("a planned session starts on %+v (%v)", at, err)
			}
		})
	}
}
