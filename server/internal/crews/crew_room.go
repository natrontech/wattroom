package crews

import (
	"net/http"
	"slices"
	"time"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

type sightingJSON struct {
	Kind   string    `json:"kind"`
	SeenAt time.Time `json:"seenAt"`
}

// handleCrewSightings: the visitors the crew's room has seen, for its members.
func (s *Service) handleCrewSightings(w http.ResponseWriter, r *http.Request) {
	crew, _, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	rows, err := s.store.Queries.ListCrewSightings(r.Context(), crew.ID)
	if err != nil {
		httpx.Fail(w, s.log, "sightings failed", err, "The album could not be loaded.", "crew", store.UUIDString(crew.ID))
		return
	}
	out := make([]sightingJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, sightingJSON{Kind: row.Kind, SeenAt: row.SeenAt.Time})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"sightings": out})
}

// handleAddCrewSighting: a member's screen saw a visitor. The room's visitors
// are a function of the clock, so a client can claim one it did not see. It
// costs nothing: an album entry is paint, and the set is closed.
func (s *Service) handleAddCrewSighting(w http.ResponseWriter, r *http.Request) {
	crew, _, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	var req struct {
		Kind string `json:"kind"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	if !slices.Contains(protocol.LoungeVisitors, req.Kind) {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "That visitor is not in the album.")
		return
	}
	if _, err := s.store.Queries.AddCrewSighting(r.Context(), db.AddCrewSightingParams{CrewID: crew.ID, Kind: req.Kind}); err != nil {
		httpx.Fail(w, s.log, "sighting failed", err, "The album could not be written.", "crew", store.UUIDString(crew.ID))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
