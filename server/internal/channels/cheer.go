package channels

import (
	"net/http"
	"strings"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
)

// handleCheer is a cheer from afar (#3275): Home's around-now shows a
// crewmate in a voice channel, and one tap tells them they are seen. The
// gate is the around-now read's own — the voice channels the sender may
// enter, and who the hub has in them — so it reaches nobody the sender could
// not already see. A rider hidden either way is answered as if it landed
// (#3202, the hub's half); no XP and no wallet row, a cheer is never a reward.
func (s *Service) handleCheer(w http.ResponseWriter, r *http.Request) {
	channel, user, _, ok := s.channelFor(w, r)
	if !ok {
		return
	}
	var req struct {
		To    string `json:"to"`
		Emoji string `json:"emoji"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	if channel.Kind != kindVoice {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "Nobody rides in a chat channel — cheer someone in a voice channel.")
		return
	}
	if !protocol.IsReaction(req.Emoji) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "Choose one of your cheers.", "emoji")
		return
	}
	me := store.UUIDString(user.ID)
	to := strings.TrimSpace(req.To)
	if to == "" || to == me {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "Choose another rider to cheer.", "to")
		return
	}
	// Spent before the hub is asked, like a DM poke: the ceiling is on asking.
	if !s.cheers.Spend([2]string{me, to}) {
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			"You just cheered them — give them a moment to hear it.")
		return
	}
	if s.live == nil || !s.live.CheerAfar(store.UUIDString(channel.ID), protocol.Cheer{
		Emoji: req.Emoji, From: user.DisplayName, FromID: me, To: to,
	}) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "They have left "+channel.Name+".")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
