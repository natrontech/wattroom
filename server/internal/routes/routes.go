// Package routes keeps a rider's roads (#3024, ADR-0063): the road every
// ~20 m that anyone may one day be sent, and the place — the owner's shape —
// sealed, for the owner alone. A server with no key keeps the road and never
// the place.
//
// Every route here is its owner's: the reads are keyed by owner, so someone
// else's route reads as absent. Sessions only — a personal token, which is how
// a coach's AI reads rides, never reaches a route (AGENTS.md: no coordinates
// in an AI context).
package routes

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/secrets"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

const (
	// docs/SPEC.md "Route rides": the file a rider imports is at most 5 MB,
	// and what the browser parsed out of it is never larger.
	maxBodyBytes = 5 << 20
	// The most points a place may hold (#3024): about 25 KB sealed for a
	// 53 km loop, and a 200 km route at 10 m is 20,000.
	maxPlacePoints = 50_000
	// $lib/road's MAX_CLIMBS.
	maxClimbs = 32
	// docs/SPEC.md's names: a route's, like a workout's, is 1–80 characters.
	maxNameRunes = 80
)

// Users is who is asking. The session source, never the token one.
type Users interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

type Service struct {
	store *store.Store
	users Users
	keys  *secrets.Cipher
	log   *slog.Logger
}

// New takes the server's key; nil, or one not configured, stores roads only.
func New(st *store.Store, users Users, keys *secrets.Cipher, log *slog.Logger) *Service {
	return &Service{store: st, users: users, keys: keys, log: log}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/routes", s.handleList)
	mux.HandleFunc("POST /api/routes", s.handleCreate)
	mux.HandleFunc("GET /api/routes/{id}", s.handleGet)
	mux.HandleFunc("PATCH /api/routes/{id}", s.handleRename)
	mux.HandleFunc("DELETE /api/routes/{id}", s.handleDelete)
	mux.HandleFunc("GET /api/routes/{id}/shape", s.handleShape)
}

// noKeyHint is the one line a route stored without its place carries.
const noKeyHint = "This server keeps a route's heights, not its map: it has no key to seal the map with."

type climbJSON struct {
	StartM float64 `json:"startM"`
	TopM   float64 `json:"topM"`
	GainM  float64 `json:"gainM"`
	Cls    *string `json:"cls"`
}

type routeJSON struct {
	ID string `json:"id"`
	// The owner's own name; every other surface shows generatedName.
	Name          string          `json:"name"`
	GeneratedName string          `json:"generatedName"`
	Src           string          `json:"src"`
	LengthM       int32           `json:"lengthM"`
	GainM         int32           `json:"gainM"`
	Climbs        json.RawMessage `json:"climbs"`
	// Whether the server kept the map, not only the heights.
	HasPlace bool `json:"hasPlace"`
	// A route from strava.com rides owner-only (ADR-0063).
	OwnerOnly bool      `json:"ownerOnly"`
	CreatedAt time.Time `json:"createdAt"`
	// Set on one route read, never on the list.
	Road      []byte `json:"road,omitempty"`
	RoadHash  string `json:"roadHash,omitempty"`
	EleSource string `json:"eleSource,omitempty"`
	Hint      string `json:"hint,omitempty"`
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Sign in to see your routes.")
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListOwnerRoutes(r.Context(), user.ID)
	if err != nil {
		httpx.Fail(w, s.log, "list routes failed", err, "Your routes could not be loaded.")
		return
	}
	out := make([]routeJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, routeJSON{
			ID: store.UUIDString(row.ID), Name: row.Name, GeneratedName: row.GenName, Src: row.Src,
			LengthM: row.LengthM, GainM: row.GainM, Climbs: row.Climbs, HasPlace: row.HasPlace,
			OwnerOnly: row.Src == "stravagpx", CreatedAt: row.CreatedAt.Time,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"routes": out})
}

func (s *Service) handleGet(w http.ResponseWriter, r *http.Request) {
	user, id, ok := s.owned(w, r)
	if !ok {
		return
	}
	row, err := s.store.Queries.GetOwnerRoute(r.Context(), db.GetOwnerRouteParams{ID: id, OwnerID: user.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		notFound(w)
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "get route failed", err, "That route could not be loaded.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, routeJSON{
		ID: store.UUIDString(row.ID), Name: row.Name, GeneratedName: row.GenName, Src: row.Src,
		LengthM: row.LengthM, GainM: row.GainM, Climbs: row.Climbs, HasPlace: row.HasPlace,
		OwnerOnly: row.Src == "stravagpx", CreatedAt: row.CreatedAt.Time,
		Road: row.Road, RoadHash: row.RoadHash, EleSource: row.EleSource,
	})
}

// handleShape is the place, for its owner alone (ADR-0063).
func (s *Service) handleShape(w http.ResponseWriter, r *http.Request) {
	user, id, ok := s.owned(w, r)
	if !ok {
		return
	}
	row, err := s.store.Queries.GetOwnerRoutePlace(r.Context(), db.GetOwnerRoutePlaceParams{ID: id, OwnerID: user.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		notFound(w)
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "get route place failed", err, "That route's map could not be loaded.")
		return
	}
	if row.GeomSealed == nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", noKeyHint)
		return
	}
	shape, err := Open(s.keys, row.GeomSealed, row.KeyVersion)
	if err != nil {
		httpx.Fail(w, s.log, "route place would not open", err,
			"This route's map is sealed under a key this server no longer holds. Its heights still ride.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"shape": shape})
}

func (s *Service) handleRename(w http.ResponseWriter, r *http.Request) {
	user, id, ok := s.owned(w, r)
	if !ok {
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := httpx.DecodeStrict(r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || utf8.RuneCountInString(name) > maxNameRunes {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"A route name has to be 1–80 characters.", "name")
		return
	}
	n, err := s.store.Queries.RenameRoute(r.Context(), db.RenameRouteParams{ID: id, OwnerID: user.ID, Name: name})
	if err != nil {
		httpx.Fail(w, s.log, "rename route failed", err, "The route could not be renamed.")
		return
	}
	if n == 0 {
		notFound(w)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"id": store.UUIDString(id), "name": name})
}

// handleDelete erases the route, place and all (ADR-0063). Nothing else holds
// its coordinates to clean up after it.
func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	user, id, ok := s.owned(w, r)
	if !ok {
		return
	}
	n, err := s.store.Queries.DeleteRoute(r.Context(), db.DeleteRouteParams{ID: id, OwnerID: user.ID})
	if err != nil {
		httpx.Fail(w, s.log, "delete route failed", err, "The route could not be deleted.")
		return
	}
	if n == 0 {
		notFound(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// owned is the signed-in rider and the route id in the path.
func (s *Service) owned(w http.ResponseWriter, r *http.Request) (db.User, pgtype.UUID, bool) {
	user, ok := s.users.RequireUser(w, r, "Sign in to see your routes.")
	if !ok {
		return db.User{}, pgtype.UUID{}, false
	}
	id, err := store.ParseUUID(r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a route id.")
		return db.User{}, pgtype.UUID{}, false
	}
	return user, id, true
}

func notFound(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusNotFound, "not_found", "That route is not one of yours.")
}

// roadHash is the road's identity: SHA-256 of its packed bytes, in hex —
// $lib/road's roadHash, taken over what the server keeps.
func roadHash(packed []byte) string {
	sum := sha256.Sum256(packed)
	return hex.EncodeToString(sum[:])
}

// placeOf seals a route's shape, or says why it will not be kept. The shape
// is decoded first, so a string that is not a polyline, or one past
// maxPlacePoints, never reaches the table sealed or not.
func placeOf(keys *secrets.Cipher, shape string) (sealed []byte, version *int32, err error) {
	if !keys.Enabled() {
		return nil, nil, nil
	}
	points, err := road.DecodePolyline6(shape, maxPlacePoints)
	if err != nil || len(points) < 2 {
		return nil, nil, errors.New("not a route shape")
	}
	sealed, err = keys.Seal(shape)
	if err != nil {
		return nil, nil, err
	}
	v := keys.Version()
	return sealed, &v, nil
}

// Open is a sealed place back as its polyline, under the key it was sealed
// with — a row from before a rotation that nobody re-sealed is an error, never
// garbage.
func Open(keys *secrets.Cipher, sealed []byte, version *int32) (string, error) {
	if version == nil || !keys.Enabled() || *version != keys.Version() {
		return "", errors.New("routes: sealed under a key this server does not hold")
	}
	return keys.Open(sealed)
}
