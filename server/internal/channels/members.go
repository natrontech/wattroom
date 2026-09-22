package channels

import (
	"net/http"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// handleNameMember lets one member of the crew into a private channel — the
// successor of a room's grant (ADR-0058). Idempotent: naming somebody twice
// names them once.
func (s *Service) handleNameMember(w http.ResponseWriter, r *http.Request) {
	channel, user, role, ok := s.channelFor(w, r)
	if !ok || !requireAdmin(w, role) {
		return
	}
	if !channel.Private {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error",
			"This channel is open to the whole crew already — make it private first.")
		return
	}
	target, err := store.ParseUUID(r.PathValue("userID"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "They are not in this crew.")
		return
	}
	targetRole, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: channel.CrewID, UserID: target})
	if err != nil {
		httpx.Fail(w, s.log, "crew role lookup failed", err, "They could not be let in.")
		return
	}
	// Only somebody in the crew can be let into one of its channels: a door
	// inside the crew is not a way into it, and a banned rider is not in it.
	if targetRole == "" || targetRole == "banned" {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "They are not in this crew.")
		return
	}
	if err := s.store.Queries.NameChannelMember(r.Context(), db.NameChannelMemberParams{
		ChannelID: channel.ID, UserID: target, AddedBy: user.ID,
	}); err != nil {
		httpx.Fail(w, s.log, "name channel member failed", err, "They could not be let in.", "channel", store.UUIDString(channel.ID))
		return
	}
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}

// handleUnnameMember takes somebody back out of a private channel. It asks
// nothing of who they are now, so a row left by somebody who has since gone
// can still be cleared.
func (s *Service) handleUnnameMember(w http.ResponseWriter, r *http.Request) {
	channel, _, role, ok := s.channelFor(w, r)
	if !ok || !requireAdmin(w, role) {
		return
	}
	target, err := store.ParseUUID(r.PathValue("userID"))
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "They are not in this channel.")
		return
	}
	if err := s.store.Queries.UnnameChannelMember(r.Context(), db.UnnameChannelMemberParams{
		ChannelID: channel.ID, UserID: target,
	}); err != nil {
		httpx.Fail(w, s.log, "unname channel member failed", err, "They could not be taken out.", "channel", store.UUIDString(channel.ID))
		return
	}
	s.changed()
	w.WriteHeader(http.StatusNoContent)
}
