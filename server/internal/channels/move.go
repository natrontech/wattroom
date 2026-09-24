package channels

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// handleMove is Discord's drag (#2730): the crew's owner or an admin moves a
// rider from one of its voice channels into another. The path names where
// they go; the body names who and where from. The hub tells the rider's
// client, which goes the way a sidebar click would, call and all.
func (s *Service) handleMove(w http.ResponseWriter, r *http.Request) {
	to, user, role, ok := s.channelFor(w, r)
	if !ok || !requireAdmin(w, role) {
		return
	}
	var req struct {
		Rider string `json:"rider"`
		From  string `json:"from"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	if to.Kind != kindVoice {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "Riders move into a voice channel, not a text one.")
		return
	}
	fromID, err := store.ParseUUID(req.From)
	if err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "Say which voice channel they are in.", "from")
		return
	}
	from, err := s.store.Queries.GetChannel(r.Context(), fromID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (from.CrewID != to.CrewID || from.Kind != kindVoice)) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "That voice channel is not in this crew.")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "channel lookup failed", err, "They could not be moved.")
		return
	}
	if from.ID == to.ID {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "They are in "+to.Name+" already.")
		return
	}
	rider, err := store.ParseUUID(req.Rider)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "They are not in this crew.")
		return
	}
	// The move walks them through the destination's door, so it asks the
	// door's question on their behalf (mayEnter).
	riderRole, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: to.CrewID, UserID: rider})
	if err != nil {
		httpx.Fail(w, s.log, "crew role lookup failed", err, "They could not be moved.")
		return
	}
	if riderRole == "" || riderRole == "banned" {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "They are not in this crew.")
		return
	}
	named := false
	if to.Private && riderRole == "member" {
		if named, err = s.store.Queries.IsNamedInChannel(r.Context(), db.IsNamedInChannelParams{
			ChannelID: to.ID, UserID: rider,
		}); err != nil {
			httpx.Fail(w, s.log, "channel membership lookup failed", err, "They could not be moved.")
			return
		}
	}
	if !mayEnter(riderRole, to.Private, named) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden",
			to.Name+" is private and does not name them — name them into it first.")
		return
	}
	err = hub.ErrNotInChannel
	if s.live != nil {
		err = s.live.Move(store.UUIDString(from.ID), store.UUIDString(rider), protocol.Moved{
			Channel: store.UUIDString(to.ID), Name: to.Name, By: user.DisplayName,
		})
	}
	switch {
	case errors.Is(err, hub.ErrNotInChannel):
		httpx.WriteError(w, http.StatusConflict, "conflict", "They have already left "+from.Name+".")
	case errors.Is(err, hub.ErrRiding):
		httpx.WriteError(w, http.StatusConflict, "conflict",
			"They are riding, and a move would end their ride. Try again once they stop pedalling.")
	case err != nil:
		httpx.Fail(w, s.log, "move failed", err, "They could not be moved.")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
