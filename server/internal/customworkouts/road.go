package customworkouts

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/routes"
	"github.com/natrontech/wattroom/server/internal/workout"
)

// A saved workout's road (#3051): one of its author's own routes, Strava's
// included — nobody else reads a rider's shelf — and read back whole.

// SetRoads wires the routes in; without them a workout may name no road.
func (s *Service) SetRoads(a *routes.Attacher) { s.roads = a }

// ownRoad refuses a workout whose road is not one of its author's routes,
// and answers false once it has written the refusal.
func (s *Service) ownRoad(w http.ResponseWriter, r *http.Request, def json.RawMessage, owner pgtype.UUID) bool {
	if s.roads == nil {
		if ref, _ := workout.RoadOf(string(def)); ref != nil {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"This server does not ride roads yet, so a workout cannot carry one.", "workout")
			return false
		}
		return true
	}
	err := s.roads.CheckOwn(r.Context(), string(def), owner)
	var refused routes.Refused
	if errors.As(err, &refused) {
		httpx.WriteFieldError(w, http.StatusForbidden, "forbidden", string(refused), "workout")
		return false
	}
	if err != nil {
		httpx.Fail(w, s.log, "workout road check failed", err, "The workout could not be saved. Try again.")
		return false
	}
	return true
}

// readable is a saved workout with its road attached for its owner — the
// whole road, since the shelf is theirs alone. A road that cannot be read
// goes back as its bare reference.
func (s *Service) readable(ctx context.Context, def []byte, owner pgtype.UUID) json.RawMessage {
	if s.roads == nil {
		return def
	}
	out, err := s.roads.Attach(ctx, string(def), owner)
	if err != nil {
		s.log.Warn("saved workout road unreadable", "err", err)
		return def
	}
	return json.RawMessage(out)
}
