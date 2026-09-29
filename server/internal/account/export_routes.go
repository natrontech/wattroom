package account

import (
	"encoding/json"

	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/routes"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The rider's stored roads (#3024, ADR-0063, ADR-0053): the list in
// routes.json, and each route whose map the server kept as a GPX under
// routes/ — built from the sealed place, opened for its owner and nobody else.

// routeFile is one GPX, held until the file-writing half writes it.
type routeFile struct {
	name string
	gpx  []byte
}

func (x *export) routes() category {
	return x.bounded("routes.json", []string{"routes"}, func() (any, int, error) {
		rows, err := x.q.ExportUserRoutes(x.ctx, db.ExportUserRoutesParams{
			UserID: x.user.ID, Lim: maxExportRows,
		})
		if err != nil {
			return nil, 0, err
		}
		out := make([]any, 0, len(rows))
		for _, row := range rows {
			one := map[string]any{"name": row.Name, "generatedName": row.GenName,
				"source": row.Src, "lengthM": row.LengthM, "gainM": row.GainM,
				"climbs": json.RawMessage(row.Climbs), "heightsFrom": row.EleSource,
				"createdAt": row.CreatedAt.Time, "file": nil,
				// Whether each crew listed in the directory may see its map (#3569).
				"crews": json.RawMessage(row.CrewAnswers)}
			// The whole road, heights above sea included (#3511); a seal
			// this key will not open exports the bare heights, and its map
			// below says why it has no file.
			whole, err := routes.WholeRoad(x.keys, row.Road, row.RoadSealed, row.KeyVersion)
			if err != nil {
				whole = row.Road
			}
			rd, err := road.UnpackRoad(whole)
			if err != nil {
				return nil, 0, err
			}
			if row.GeomSealed == nil {
				// Kept without its map (no key when it was stored): its
				// heights are all there is, so they are what it exports.
				one["heightsM"] = rd.Heights
				out = append(out, one)
				continue
			}
			x.routesWithPlace++
			place, err := x.routePlace(row)
			if err != nil {
				// The manifest counts it, so a missing GPX is never silent.
				one["map"] = "sealed under a key this server no longer holds"
				out = append(out, one)
				continue
			}
			name := "routes/" + row.CreatedAt.Time.UTC().Format("2006-01-02") + "-" +
				store.UUIDString(row.ID)[:8] + ".gpx"
			x.routeFiles = append(x.routeFiles, routeFile{name, routes.GPX(row.Name, place, rd.Heights)})
			one["file"] = name
			out = append(out, one)
		}
		return out, len(rows), nil
	})
}

// routePlace opens one route's sealed map as points.
func (x *export) routePlace(row db.ExportUserRoutesRow) ([]road.LatLon, error) {
	shape, err := routes.Open(x.keys, row.GeomSealed, row.KeyVersion)
	if err != nil {
		return nil, err
	}
	return road.DecodePolyline6(shape, -1)
}
