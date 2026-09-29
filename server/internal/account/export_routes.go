package account

import (
	"encoding/json"
	"io"

	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/routes"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The rider's stored roads (#3024, ADR-0063, ADR-0053): the list in
// routes.json, and each route whose map the server kept as a GPX under
// routes/ — built from the sealed place, opened for its owner and nobody else.

// routeFile is one GPX to write, as routes.json names it: the route's row,
// kept until the file-writing half builds its GPX, one at a time (#3580) —
// 200 routes of 50,000 points each, built up front, held 660 MB at once.
type routeFile struct {
	name string
	row  db.ExportUserRoutesRow
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
			if _, err := x.routePlace(row); err != nil {
				// The manifest counts it, so a missing GPX is never silent.
				one["map"] = "sealed under a key this server no longer holds"
				out = append(out, one)
				continue
			}
			name := "routes/" + row.CreatedAt.Time.UTC().Format("2006-01-02") + "-" +
				store.UUIDString(row.ID)[:8] + ".gpx"
			x.routeFiles = append(x.routeFiles, routeFile{name, row})
			one["file"] = name
			out = append(out, one)
		}
		return out, len(rows), nil
	})
}

// gpx builds one route's file: its map opened for its owner, its whole
// road's heights above sea.
func (x *export) gpx(f routeFile) ([]byte, error) {
	place, err := x.routePlace(f.row)
	if err != nil {
		return nil, err
	}
	whole, err := routes.WholeRoad(x.keys, f.row.Road, f.row.RoadSealed, f.row.KeyVersion)
	if err != nil {
		whole = f.row.Road
	}
	rd, err := road.UnpackRoad(whole)
	if err != nil {
		return nil, err
	}
	return routes.GPX(f.row.Name, place, rd.Heights), nil
}

// writeRoutes builds each route's GPX and writes it before it builds the
// next, so an export holds one at a time (#3580). A route whose file cannot
// be built is left out and counted, as the manifest's "written" says.
func (x *export) writeRoutes(create func(name string) (io.Writer, error), build func(routeFile) ([]byte, error)) (int, error) {
	written := 0
	for _, f := range x.routeFiles {
		gpx, err := build(f)
		if err != nil {
			continue
		}
		w, err := create(f.name)
		if err == nil {
			_, err = w.Write(gpx)
		}
		if err != nil {
			return written, err
		}
		written++
	}
	return written, nil
}

// routePlace opens one route's sealed map as points.
func (x *export) routePlace(row db.ExportUserRoutesRow) ([]road.LatLon, error) {
	shape, err := routes.Open(x.keys, row.GeomSealed, row.KeyVersion)
	if err != nil {
		return nil, err
	}
	return road.DecodePolyline6(shape, -1)
}
