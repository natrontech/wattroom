package dms

import (
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
)

// Live is the hub, as far as a conversation reaches it: the tap of a poke,
// and the lobby pings that keep every open conversation list current
// (#2937) — which used to be a 10 s poll from every tab.
type Live interface {
	// A poke heard now, in whichever channel the rider is in. The thread row
	// is the record; this is the tap.
	PokeRider(riderID string, poke protocol.Poke)
	// Both riders of a conversation: something in it changed.
	DmChanged(a, b string)
	// The reader's own devices, and nobody else's: a read heard by the peer
	// is a read receipt (ADR-0012).
	ReadChanged(userID string)
}

// changed pings both sides of the pair after a write they both see.
func (s *Service) changed(me, peer pgtype.UUID) {
	if s.live != nil {
		s.live.DmChanged(store.UUIDString(me), store.UUIDString(peer))
	}
}
