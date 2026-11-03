package routes

import (
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"os"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// A road imported before #4383 is straightened at boot from its own sealed
// line (#4379, #4383): its turns become the line's, while its heights, its
// bare road and its hash — what ghosts and times match on — stay, and the
// next boot leaves it be.
func TestTheBootStraightensARoadFromItsOwnLine(t *testing.T) {
	keys := testKey(t, "k")
	h := setup(t, keys)
	// An invented line from the shared vectors: the 21-hairpin climb.
	raw, err := os.ReadFile("../road/testdata/turns-golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden struct {
		Vectors []struct {
			Shape string `json:"shape"`
			Turns []int8 `json:"turns"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	line := golden.Vectors[0]
	points, err := road.DecodePolyline6(line.Shape, maxPlacePoints)
	if err != nil {
		t.Fatal(err)
	}
	want := road.TurnsOfShape(points, storeEvery)
	// As the old import stored it: every turn its own rounding — here none at all.
	old := road.Road{LengthM: 20 * float64(len(want)), Heights: make([]float64, len(want)+1), Turns: make([]int8, len(want))}
	for i := range old.Heights {
		old.Heights[i] = 700 + 1.6*float64(i)
	}
	packed := old.Pack()
	stored, err := road.UnpackRoad(packed)
	if err != nil {
		t.Fatal(err)
	}
	sealedRoad, err := sealRoad(keys, packed)
	if err != nil {
		t.Fatal(err)
	}
	sealedLine, err := keys.Seal(line.Shape)
	if err != nil {
		t.Fatal(err)
	}
	version := keys.Version()
	row, err := h.store.Queries.CreateRoute(t.Context(), db.CreateRouteParams{
		OwnerID: h.users.ByToken["alice"].ID, Src: "gpx", Name: "Old import", GenName: "Road · 7.0 km · 560 m",
		Road: bare(old), RoadSealed: sealedRoad, GeomSealed: sealedLine, KeyVersion: &version,
		RoadHash: roadHash(packed), LengthM: int32(old.LengthM), GainM: 560, Climbs: []byte("[]"), EleSource: "file",
	})
	if err != nil {
		t.Fatalf("create route: %v", err)
	}

	read := func() (road.Road, []byte, string, *int16) {
		var bareRoad, sealed []byte
		var hash string
		var v *int16
		if err := h.store.Pool.QueryRow(t.Context(), "select road, road_sealed, road_hash, turns_v from routes where id = $1", row.ID).Scan(&bareRoad, &sealed, &hash, &v); err != nil {
			t.Fatal(err)
		}
		text, err := keys.Open(sealed)
		if err != nil {
			t.Fatal(err)
		}
		whole, _ := base64.StdEncoding.DecodeString(text)
		rd, err := road.UnpackRoad(whole)
		if err != nil {
			t.Fatal(err)
		}
		return rd, bareRoad, hash, v
	}

	StraightenRoads(t.Context(), h.store.Queries, keys, slog.New(slog.DiscardHandler))
	rd, bareAfter, hash, v := read()
	if !slices.Equal(rd.Turns, want) {
		t.Fatal("the sealed road's turns are not its line's")
	}
	if !slices.Equal(rd.Heights, stored.Heights) || rd.LengthM != stored.LengthM {
		t.Fatal("straightening moved the road's heights or length")
	}
	if hash != roadHash(packed) || string(bareAfter) != string(bare(old)) {
		t.Fatal("straightening changed the road's identity or its bare copy")
	}
	if v == nil || *v != turnsRule {
		t.Fatalf("turns_v reads %v, want %d", v, turnsRule)
	}

	// The next boot reads nothing to do.
	rows, err := h.store.Queries.ListRoutesToStraighten(t.Context(), db.ListRoutesToStraightenParams{KeyVersion: &version, TurnsV: turnsRule, After: pgtype.UUID{Valid: true}, Lim: 100})
	if err != nil || slices.ContainsFunc(rows, func(r db.ListRoutesToStraightenRow) bool { return r.ID == row.ID }) {
		t.Fatalf("after one boot the road still waits (%v)", err)
	}
}
