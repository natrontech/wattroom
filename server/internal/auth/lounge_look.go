package auth

// The rider's figure in the cozy room, put together from parts in the
// lounge's editor. Cosmetic and free: nothing reads it but the lounge's
// drawing, so the server keeps its shape and leaves its meaning to the client.

import (
	"net/http"
	"regexp"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// loungeLookShape is one base-36 character per part, with room for parts to
// come. Rides every roster, so it stays this small.
var loungeLookShape = regexp.MustCompile(`^[0-9a-z]{1,16}$`)

// handleSetLoungeLook stores the look, or clears it back to the seeded one
// with "", and carries it to every voice channel the rider stands in.
func (s *Service) handleSetLoungeLook(w http.ResponseWriter, r *http.Request) {
	user, ok := s.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	var req struct {
		Look string `json:"look"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That look could not be read.")
		return
	}
	var look *string
	if req.Look != "" {
		if !loungeLookShape.MatchString(req.Look) {
			httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
				"That look is not one the lounge makes. Pick its parts again.", "look")
			return
		}
		look = &req.Look
	}
	updated, err := s.store.Queries.SetUserLoungeLook(r.Context(), db.SetUserLoungeLookParams{ID: user.ID, LoungeLook: look})
	if err != nil {
		httpx.Fail(w, s.log, "lounge look update failed", err, "Your look could not be saved. Try again.")
		return
	}
	if s.live != nil {
		s.live.SetProfile(store.RiderOf(updated))
	}
	httpx.WriteJSON(w, http.StatusOK, s.fullMe(r.Context(), updated))
}
