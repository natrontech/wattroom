package auth

// The main crew (#2144, ADR-0038 amended): a rider in more than one crew
// names the one the sidebar opens in, and it follows the account rather than
// the device — a fresh browser used to open whichever crew the server listed
// first. Its own route for the reason the timezone has one: one value,
// written from a menu, must not resend a profile form or race one.

import (
	"net/http"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

func (s *Service) handleSetHomeCrew(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	var req struct {
		CrewID string `json:"crewId"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	id, err := store.ParseUUID(req.CrewID)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That is not a crew id.", "crewId")
		return
	}
	// Only a crew of yours: a main crew you cannot open would blank the
	// sidebar's header. The role lookup answers "" for a crew that does not
	// exist and for one you are not in alike, and neither is told apart —
	// a crew's existence is not public (crewByID says the same).
	role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: id, UserID: user.ID})
	if err != nil || role == "" || role == "banned" {
		httpx.WriteFieldError(w, http.StatusNotFound, "not_found", "You are not in that crew.", "crewId")
		return
	}
	updated, err := s.store.Queries.SetUserHomeCrew(r.Context(), db.SetUserHomeCrewParams{ID: user.ID, HomeCrewID: id})
	if err != nil {
		httpx.Fail(w, s.log, "home crew update failed", err, "Your main crew could not be saved. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s.fullMe(r.Context(), updated))
}
