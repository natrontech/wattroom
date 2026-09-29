package account

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/secrets"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/testx"
)

func routeKey(t *testing.T, letter string) *secrets.Cipher {
	t.Helper()
	keys, err := secrets.FromKey("TEST_KEY", base64.StdEncoding.EncodeToString([]byte(strings.Repeat(letter, 32))))
	if err != nil {
		t.Fatal(err)
	}
	return keys
}

// A rider's routes travel with the export (ADR-0053, ADR-0063, #3024): a GPX
// for each route whose map the server kept, opened for its owner, and the
// heights of one kept without a map. The manifest counts the GPX files, so a
// route whose map will not open is never silently missing.
func TestExportCarriesTheRidersRoutes(t *testing.T) {
	h := setup(t)
	keys := routeKey(t, "k")
	h.svc.SetRouteKeys(keys)
	shape := testx.Polyline6([][2]float64{{-48.8767, -123.3933}, {-48.87, -123.395}, {-48.865, -123.397}})
	sealed, err := keys.Seal(shape)
	if err != nil {
		t.Fatal(err)
	}
	version := keys.Version()
	// Stored as the server stores it (#3511): with a key, the whole road
	// sealed and the table's copy bare — heights from 0, so an <ele> above
	// sea can only have come from the seal.
	bareHeights := make([]float64, 151)
	for i := range bareHeights {
		bareHeights[i] = 20 * float64(i) / 150
	}
	roadSealed, err := keys.Seal(base64.StdEncoding.EncodeToString(testx.FlatRoad(3000, 20)))
	if err != nil {
		t.Fatal(err)
	}
	keep := func(name string, geom []byte, v *int32) pgtype.UUID {
		t.Helper()
		stored, sealedRoad := testx.FlatRoad(3000, 20), []byte(nil)
		if geom != nil {
			stored, sealedRoad = testx.PackedRoad(3000, bareHeights), roadSealed
		}
		row, err := h.store.Queries.CreateRoute(t.Context(), db.CreateRouteParams{
			OwnerID: h.id("alice"), Src: "gpx", Name: name, GenName: "Road · 3.0 km · 20 m",
			Road: stored, RoadSealed: sealedRoad, RoadHash: "h", LengthM: 3000, GainM: 20,
			Climbs: []byte("[]"), EleSource: "file", GeomSealed: geom, KeyVersion: v,
		})
		if err != nil {
			t.Fatal(err)
		}
		return row.ID
	}
	mapped := keep("Stollestich & back", sealed, &version)
	keep("Heights only", nil, nil)
	// The owner's answers for two crews listed in the directory (#3569).
	for name, shared := range map[string]bool{"Hinterfeld RC": true, "Oberstolle Velo": false} {
		crew := testx.Crew(t, h.store, name, h.id("alice"))
		if err := h.store.Queries.SetRouteCrewConsent(t.Context(), db.SetRouteCrewConsentParams{RouteID: mapped, CrewID: crew, Shared: shared}); err != nil {
			t.Fatal(err)
		}
	}

	files := h.exportFiles(t, "alice")
	var rows []map[string]any
	if err := json.Unmarshal([]byte(files["routes.json"]), &rows); err != nil || len(rows) != 2 {
		t.Fatalf("routes.json: %v %q", err, files["routes.json"])
	}
	var gpx string
	for _, row := range rows {
		switch row["name"] {
		case "Stollestich & back":
			answers := map[string]bool{}
			crews, _ := row["crews"].([]any)
			for _, a := range crews {
				a, _ := a.(map[string]any)
				crew, _ := a["crew"].(string)
				shared, _ := a["shared"].(bool)
				answers[crew] = shared
				if a["crewId"] == nil || a["decidedAt"] == nil {
					t.Errorf("an answer without its crew id or time: %v", a)
				}
			}
			if len(answers) != 2 || !answers["Hinterfeld RC"] || answers["Oberstolle Velo"] {
				t.Errorf("the route's answers: %v, want Hinterfeld RC yes and Oberstolle Velo no", row["crews"])
			}
			file, _ := row["file"].(string)
			gpx = files[file]
			if !strings.HasPrefix(file, "routes/") || gpx == "" {
				t.Fatalf("the mapped route has no GPX: %v", row)
			}
		case "Heights only":
			if row["file"] != nil || len(row["heightsM"].([]any)) != 151 { //nolint:errcheck // asserted by the length
				t.Fatalf("the heights-only route: %v", row)
			}
			if crews, ok := row["crews"].([]any); !ok || len(crews) != 0 {
				t.Errorf("a route with no answers exports %v, want []", row["crews"])
			}
		}
	}
	for _, want := range []string{`<name>Stollestich &amp; back</name>`, `lat="-48.876700" lon="-123.393300"`, `lat="-48.865000" lon="-123.397000"><ele>120.00</ele>`} {
		if !strings.Contains(gpx, want) {
			t.Errorf("the GPX lacks %s:\n%s", want, gpx)
		}
	}
	if !strings.Contains(files["manifest.json"], `"withMap": 1`) || !strings.Contains(files["manifest.json"], `"complete": true`) {
		t.Errorf("manifest: %s", files["manifest.json"])
	}

	// A key rotated without the re-seal: the map stays sealed, and the
	// manifest says the export is short rather than going quietly without it.
	h.svc.SetRouteKeys(routeKey(t, "z"))
	files = h.exportFiles(t, "alice")
	if strings.Contains(files["routes.json"], "routes/") || !strings.Contains(files["routes.json"], "no longer holds") {
		t.Errorf("routes.json under another key: %s", files["routes.json"])
	}
	if !strings.Contains(files["manifest.json"], `"complete": false`) {
		t.Errorf("an export missing a GPX called itself complete: %s", files["manifest.json"])
	}
}
