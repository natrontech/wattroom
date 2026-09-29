package account

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

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
	shape := testx.Polyline6([][2]float64{{47.3547, 8.55}, {47.36, 8.548}, {47.365, 8.546}})
	sealed, err := keys.Seal(shape)
	if err != nil {
		t.Fatal(err)
	}
	version := keys.Version()
	keep := func(name string, geom []byte, v *int32) {
		t.Helper()
		if _, err := h.store.Queries.CreateRoute(t.Context(), db.CreateRouteParams{
			OwnerID: h.id("alice"), Src: "gpx", Name: name, GenName: "Road · 3.0 km · 20 m",
			Road: testx.FlatRoad(3000, 20), RoadHash: "h", LengthM: 3000, GainM: 20,
			Climbs: []byte("[]"), EleSource: "file", GeomSealed: geom, KeyVersion: v,
		}); err != nil {
			t.Fatal(err)
		}
	}
	keep("Seestrasse & back", sealed, &version)
	keep("Heights only", nil, nil)

	files := h.exportFiles(t, "alice")
	var rows []map[string]any
	if err := json.Unmarshal([]byte(files["routes.json"]), &rows); err != nil || len(rows) != 2 {
		t.Fatalf("routes.json: %v %q", err, files["routes.json"])
	}
	var gpx string
	for _, row := range rows {
		switch row["name"] {
		case "Seestrasse & back":
			file, _ := row["file"].(string)
			gpx = files[file]
			if !strings.HasPrefix(file, "routes/") || gpx == "" {
				t.Fatalf("the mapped route has no GPX: %v", row)
			}
		case "Heights only":
			if row["file"] != nil || len(row["heightsM"].([]any)) != 151 { //nolint:errcheck // asserted by the length
				t.Fatalf("the heights-only route: %v", row)
			}
		}
	}
	for _, want := range []string{`<name>Seestrasse &amp; back</name>`, `lat="47.354700" lon="8.550000"`, `lat="47.365000" lon="8.546000"><ele>120.00</ele>`} {
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
