package channels

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// loungeFlushEvery bounds how often a voice channel's room is written. Flips
// are paint and may come in bursts, so only the last one in a window lands.
const loungeFlushEvery = 2 * time.Second

// LoungeKeeper keeps each voice channel's room between calls, as the hub's
// LoungeKeeper. Save only notes the state and a worker writes it, because the
// hub must not wait on a database.
type LoungeKeeper struct {
	store *store.Store
	log   *slog.Logger

	mu    sync.Mutex
	dirty map[string]protocol.LoungeState
}

// NewLoungeKeeper starts the worker, which runs until ctx ends and writes
// what is left on its way out.
func NewLoungeKeeper(ctx context.Context, st *store.Store, log *slog.Logger) *LoungeKeeper {
	k := &LoungeKeeper{store: st, log: log, dirty: make(map[string]protocol.LoungeState)}
	safego.Supervise(log, time.Now, "lounge keeper", ctx.Done(), func() {
		ticker := time.NewTicker(loungeFlushEvery)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				k.flush(context.WithoutCancel(ctx))
				return
			case <-ticker.C:
				k.flush(ctx)
			}
		}
	})
	return k
}

// Load is the room as it was left. False is a room nobody has touched, or one
// that could not be read: it opens as new, and that costs nothing.
func (k *LoungeKeeper) Load(channel string) (protocol.LoungeState, bool) {
	var state protocol.LoungeState
	id, err := store.ParseUUID(channel)
	if err != nil {
		return state, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	raw, err := k.store.Queries.ChannelLounge(ctx, id)
	if err != nil || len(raw) == 0 {
		return state, false
	}
	if err := json.Unmarshal(raw, &state); err != nil {
		k.log.Warn("lounge unreadable", "channel", channel, "err", err)
		return protocol.LoungeState{}, false
	}
	return state, true
}

// Save notes the latest state for the next flush.
func (k *LoungeKeeper) Save(channel string, state protocol.LoungeState) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.dirty[channel] = state
}

func (k *LoungeKeeper) flush(ctx context.Context) {
	k.mu.Lock()
	dirty := k.dirty
	k.dirty = make(map[string]protocol.LoungeState)
	k.mu.Unlock()
	for channel, state := range dirty {
		id, err := store.ParseUUID(channel)
		if err != nil {
			continue
		}
		raw, err := json.Marshal(state)
		if err != nil {
			continue
		}
		// Paint: one lost write costs a lamp left as it was, so no retry.
		write, cancel := context.WithTimeout(ctx, 3*time.Second)
		err = k.store.Queries.SaveChannelLounge(write, db.SaveChannelLoungeParams{ID: id, Lounge: raw})
		cancel()
		if err != nil {
			k.log.Warn("lounge not saved", "channel", channel, "err", err)
		}
	}
}
