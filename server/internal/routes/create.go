package routes

import (
	"encoding/json"
	"math"
	"net/http"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// createRequest is what $lib/road made of the file: the browser is the one
// parser (#3024), and the file itself never reaches the server.
type createRequest struct {
	// gpx, tcx, fit or stravagpx — the last rides owner-only (ADR-0063).
	Src string `json:"src"`
	// Whether the heights came from the file or the file had none.
	EleSource string `json:"eleSource"`
	// packRoad's bytes, base64 in the JSON.
	Road []byte `json:"road"`
	// The owner's shape as polyline6; sealed, or not kept at all.
	Shape  string      `json:"shape"`
	Climbs []climbJSON `json:"climbs"`
}

// A GPX downloaded from strava.com, which rides with its owner alone
// (ADR-0063): never in a plan or a session.
const stravaSrc = "stravagpx"

var (
	sources    = map[string]bool{"gpx": true, "tcx": true, "fit": true, stravaSrc: true}
	eleSources = map[string]bool{"file": true, "none": true}
	classes    = map[string]bool{"IV": true, "III": true, "II": true, "I": true, "HC": true}
)

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to keep a route.")
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req createRequest
	if err := dec.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That route could not be read.")
		return
	}
	if !sources[req.Src] {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A route comes from a GPX, TCX or FIT file.", "src")
		return
	}
	if !eleSources[req.EleSource] {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"Say where the route's heights came from: the file, or none.", "eleSource")
		return
	}
	rd, err := road.UnpackRoad(req.Road)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That is not a road this app can ride — a route is 2–200 km. Import the file again.", "road")
		return
	}
	if !climbsFit(req.Climbs, rd.LengthM) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"The route's climbs do not fit its road. Import the file again.", "climbs")
		return
	}
	climbs, err := json.Marshal(req.Climbs)
	if err != nil || req.Climbs == nil {
		climbs = []byte("[]")
	}
	sealed, version, err := placeOf(s.keys, req.Shape)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"The route's map could not be read. Import the file again.", "shape")
		return
	}
	name := rd.Name()
	created, err := s.store.Queries.CreateRoute(r.Context(), db.CreateRouteParams{
		OwnerID: user.ID, Src: req.Src, Name: name, GenName: name,
		Road: req.Road, RoadHash: roadHash(req.Road),
		LengthM: int32(math.Round(rd.LengthM)), GainM: int32(math.Round(rd.GainM())), //nolint:gosec // bounded by UnpackRoad
		Climbs: climbs, EleSource: req.EleSource, GeomSealed: sealed, KeyVersion: version,
	})
	if err != nil {
		httpx.Fail(w, s.log, "create route failed", err, "The route could not be kept. Try again.")
		return
	}
	out := routeJSON{
		ID: store.UUIDString(created.ID), Name: name, GeneratedName: name, Src: req.Src,
		LengthM: int32(math.Round(rd.LengthM)), GainM: int32(math.Round(rd.GainM())), //nolint:gosec // bounded by UnpackRoad
		Climbs: climbs, HasPlace: sealed != nil, OwnerOnly: req.Src == stravaSrc,
		CreatedAt: created.CreatedAt.Time, RoadHash: roadHash(req.Road), EleSource: req.EleSource,
	}
	if sealed == nil {
		out.Hint = noKeyHint
	}
	httpx.WriteJSON(w, http.StatusCreated, out)
}

// climbsFit: at most maxClimbs, each inside the road, rising, and classed
// only in docs/SPEC.md's classes or not at all.
func climbsFit(climbs []climbJSON, lengthM float64) bool {
	if len(climbs) > maxClimbs {
		return false
	}
	for _, c := range climbs {
		if c.StartM < 0 || c.TopM <= c.StartM || c.TopM > lengthM || c.GainM < 0 ||
			(c.Cls != nil && !classes[*c.Cls]) {
			return false
		}
	}
	return true
}
