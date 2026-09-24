package dms

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Live is the hub's half of a poke: the rider hears it now, in whichever
// channel they are in. The thread row is the record; this is the tap.
type Live interface {
	PokeRider(riderID string, poke protocol.Poke)
}

// pokePair keys the cooldown by who pokes whom: one friend cannot evade it
// with a second tab, and may still poke somebody else.
type pokePair struct{ from, to pgtype.UUID }

// handlePoke writes a poke into the pair's thread (#2721) — the line that
// says who and when, and the words if they sent any — then taps the peer
// live. Friends only, by the same SQL gate as a message.
func (s *Service) handlePoke(w http.ResponseWriter, r *http.Request) {
	me, peer, ok := s.peer(w, r)
	if !ok || s.overLine(w, me.ID) {
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	text := strings.TrimSpace(req.Text)
	if utf8.RuneCountInString(text) > protocol.MaxMessageChars {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", lengthRefusal, "text")
		return
	}
	// Spent before the insert, so a stranger's refused poke costs a slot too:
	// the ceiling is on asking, and the refusal below is only the answer.
	if !s.pokes.Spend(pokePair{me.ID, peer}) {
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			"You just poked them — give them a moment to notice.")
		return
	}
	sent, err := s.store.Queries.SendDmPoke(r.Context(), db.SendDmPokeParams{
		SenderID: me.ID, RecipientID: peer, Text: text,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "You can only poke accepted friends from here.")
		return
	}
	if err != nil {
		httpx.Fail(w, s.log, "dm poke failed", err, "The poke could not be sent. Try again.", "user", store.UUIDString(me.ID))
		return
	}
	if err := s.store.Queries.PruneDms(r.Context(), db.PruneDmsParams{
		Column1: me.ID, Column2: peer,
	}); err != nil {
		s.log.Warn("prune dms", "err", err)
	}
	at := sent.CreatedAt.Time.UnixMilli()
	if s.live != nil {
		s.live.PokeRider(store.UUIDString(peer), protocol.Poke{
			To: store.UUIDString(peer), FromID: store.UUIDString(me.ID),
			From: me.DisplayName, At: at, Text: text, Dm: true,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"id": store.UUIDString(sent.ID), "at": at,
	})
}
