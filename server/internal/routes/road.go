package routes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Who else may read a route (#3096, ADR-0063): the members of a crew whose
// plan carries it, and the members of a channel whose session is riding it
// right now. They get the road cut between its anchors and the route's
// secret — never a region's, never the owner's whole road — and the map of
// that stretch only where the crew may see it.

// Riding is the hub, asked which channels' sessions ride a route right now.
type Riding interface {
	ChannelsRiding(route string) []string
}

// SetRiding wires the hub in. Without it, a session reaches no one but by a
// plan.
func (s *Service) SetRiding(r Riding) { s.riding = r }

// roadCache is ADR-0063's client cache: a road named by its hash never
// changes, so a rider keeps it for 7 days.
const roadCache = "private, max-age=604800, immutable"

// audience is the crews through which viewer may read someone else's route.
func (s *Service) audience(ctx context.Context, route, viewer pgtype.UUID) ([]db.RouteAudienceCrewsRow, error) {
	riding := []pgtype.UUID{}
	if s.riding != nil {
		for _, ch := range s.riding.ChannelsRiding(store.UUIDString(route)) {
			if id, err := store.ParseUUID(ch); err == nil {
				riding = append(riding, id)
			}
		}
	}
	return s.store.Queries.RouteAudienceCrews(ctx, db.RouteAudienceCrewsParams{RouteID: route, Viewer: viewer, Riding: riding})
}

// mapShared says whether any of those crews may see the route's map: an
// unlisted crew may, and a listed one once the owner has said yes for it.
func mapShared(crews []db.RouteAudienceCrewsRow) bool {
	for _, c := range crews {
		if !c.Listed || c.Consent != nil && *c.Consent {
			return true
		}
	}
	return false
}

func notRidingIt(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusForbidden, "forbidden",
		"This route is its owner's. You can ride it when a crew of yours plans it or a session rides it.")
}

// handleRoad serves the road a route rides, pinned by its hash `h`: the
// whole of it to its owner, the stretch between the anchors — heights from
// zero, headings kept — to its crews. Every reader gets the route's secret.
func (s *Service) handleRoad(w http.ResponseWriter, r *http.Request) {
	user, id, ok := s.owned(w, r)
	if !ok {
		return
	}
	h := r.URL.Query().Get("h")
	if h == "" {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "Name the road by its hash.", "h")
		return
	}
	row, err := s.store.Queries.GetRouteRoad(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && row.RoadHash != h {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That road is not this route's.")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "get route road failed", err, "The road could not be loaded. Try again.")
		return
	}
	owner := row.OwnerID == user.ID
	// A route from Strava rides with its owner alone (ADR-0063): no plan or
	// pick can carry one, and no crew reads one here either.
	if !owner && row.Src == stravaSrc {
		notRidingIt(w)
		return
	}
	if !owner {
		crews, err := s.audience(r.Context(), id, user.ID)
		if err != nil {
			httpx.Fail(w, s.log, "route audience failed", err, "The road could not be loaded. Try again.")
			return
		}
		if len(crews) == 0 {
			notRidingIt(w)
			return
		}
	}
	whole, err := WholeRoad(s.keys, row.Road, row.RoadSealed, row.KeyVersion)
	if err != nil {
		whole = row.Road
	}
	ridden, err := road.UnpackRoad(whole)
	if err != nil {
		httpx.Fail(w, s.log, "stored road unreadable", err, "The road could not be loaded. Try again.")
		return
	}
	originM := 0.0
	if !owner {
		ridden, originM = ridden.Cut(protocol.RouteHiddenEndM, ridden.LengthM-protocol.RouteHiddenEndM)
	}
	key, err := s.worldKey(r.Context())
	if err != nil {
		httpx.Fail(w, s.log, "world key read failed", err, "The road could not be loaded. Try again.")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", roadCache)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"h": h, "road": ridden.Pack(), "originM": originM, "secret": key.RouteSecret(store.UUIDString(id)),
	})
}

// handleConsent records the owner's answer for one crew listed in the
// directory: may it see this route's map. Their route, and a crew they are
// in; someone else's route reads as absent.
func (s *Service) handleConsent(w http.ResponseWriter, r *http.Request) {
	user, id, ok := s.owned(w, r)
	if !ok {
		return
	}
	crew, err := store.ParseUUID(r.PathValue("crew"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That is not a crew id.")
		return
	}
	var body struct {
		Shared *bool `json:"shared"`
	}
	if err := httpx.DecodeStrict(r, &body); err != nil && !errors.Is(err, io.EOF) || body.Shared == nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "Say whether the crew may see this route's map.", "shared")
		return
	}
	if _, err := s.store.Queries.GetOwnerRoutePlace(r.Context(), db.GetOwnerRoutePlaceParams{ID: id, OwnerID: user.ID}); errors.Is(err, pgx.ErrNoRows) {
		notFound(w)
		return
	} else if err != nil {
		httpx.Fail(w, s.log, "route consent read failed", err, "That could not be saved. Try again.")
		return
	}
	role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: crew, UserID: user.ID})
	if errors.Is(err, pgx.ErrNoRows) || err == nil && role != "owner" && role != "admin" && role != "member" {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That is not a crew of yours.")
		return
	}
	if err == nil {
		err = s.store.Queries.SetRouteCrewConsent(r.Context(), db.SetRouteCrewConsentParams{RouteID: id, CrewID: crew, Shared: *body.Shared})
	}
	if err != nil {
		httpx.Fail(w, s.log, "route consent failed", err, "That could not be saved. Try again.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// crewShape is /shape's crew tier: the owner's map between the anchors, for a
// rider a crew of theirs lets read the route — and only where that crew may
// see the map. A route that is nobody's is a 404; someone else's the viewer
// does not ride is a 403.
func (s *Service) crewShape(w http.ResponseWriter, r *http.Request, viewer, id pgtype.UUID) {
	row, err := s.store.Queries.GetRoutePlace(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		notFound(w)
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "get route place failed", err, "That route's map could not be loaded.")
		return
	}
	crews, err := s.audience(r.Context(), id, viewer)
	if err != nil {
		httpx.Fail(w, s.log, "route audience failed", err, "That route's map could not be loaded.")
		return
	}
	if len(crews) == 0 || row.Src == stravaSrc {
		notRidingIt(w)
		return
	}
	if !mapShared(crews) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden",
			"The route's owner keeps its map from a crew anyone can join. Its road still rides.")
		return
	}
	if row.GeomSealed == nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", noKeyHint)
		return
	}
	shape, err := Open(s.keys, row.GeomSealed, row.KeyVersion)
	var points []road.LatLon
	if err == nil {
		points, err = road.DecodePolyline6(shape, -1)
	}
	if err != nil || len(points) < 2 {
		httpx.Fail(w, s.log, "route place would not open", err, "This route's map could not be opened. Its road still rides.")
		return
	}
	lengthM := float64(row.LengthM)
	end := float64(protocol.RouteHiddenEndM)
	between := span(points, end, lengthM-end, lengthM)
	if between == nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "This route's map is all hidden ends — there is no stretch to show.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"shape": encodePolyline6(between)})
}
