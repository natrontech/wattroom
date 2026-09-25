package friends

import (
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// partings remembers whom a rider just took a connection down with — their
// own ask withdrawn, or a friend removed — so the undo on that toast can ask
// again (#2842). The undo is a fresh request, never the friendship snapping
// back (#2008): acceptance is the other rider's to give a second time. But
// the ask it sends went by id, which needs a shared channel, and most
// friendships are made by code between riders with none (ADR-0012), so for
// exactly those the undo always failed. Having been connected a moment ago
// is the permission; only the rider who parted holds it, and it is spent on
// the one ask.
//
// In memory, like every other ephemeral thing the server holds: a restart
// forgets it, and the undo then says to ask for their code, which is true.
// An undo toast stays up until the rider acts on it (#1961), so the memory
// lasts the ask budget's own hour rather than the toast's few seconds.
//
// ponytail: one mutex over the whole map; per-rider maps if it ever shows up.
type partings struct {
	mu sync.Mutex
	at map[[2]pgtype.UUID]time.Time
}

// note remembers that me parted from them now, and lets go of whatever has
// outlived the window.
func (p *partings) note(me, them pgtype.UUID, now time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.at == nil {
		p.at = make(map[[2]pgtype.UUID]time.Time)
	}
	for pair, at := range p.at {
		if now.Sub(at) >= askWindow {
			delete(p.at, pair)
		}
	}
	p.at[[2]pgtype.UUID{me, them}] = now
}

// take spends the permission me holds to ask them again, if any.
func (p *partings) take(me, them pgtype.UUID, now time.Time) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	pair := [2]pgtype.UUID{me, them}
	at, held := p.at[pair]
	delete(p.at, pair)
	return held && now.Sub(at) < askWindow
}
