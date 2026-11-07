package channels

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// voiceTimeFlushEvery is how often hangout time is written: the hub's minutes
// gather here and land in one statement per table.
const voiceTimeFlushEvery = time.Minute

// VoiceTime keeps hangout time (docs/spec/lounge.md) as the hub's
// VoiceTimeKeeper: a rider's own seconds in voice, and a crew's seconds
// together. AddVoiceTime only adds to what is pending and a worker writes it,
// because the hub must not wait on a database. Counters only: nothing here
// pays XP or Batzen.
type VoiceTime struct {
	store *store.Store
	log   *slog.Logger

	mu sync.Mutex
	// Seconds not yet written, by rider id and by voice channel id.
	riders, together map[string]int64
}

// NewVoiceTime starts the worker, which runs until ctx ends and writes what
// is pending on its way out.
func NewVoiceTime(ctx context.Context, st *store.Store, log *slog.Logger) *VoiceTime {
	k := &VoiceTime{store: st, log: log,
		riders: make(map[string]int64), together: make(map[string]int64)}
	safego.Supervise(log, time.Now, "voice time keeper", ctx.Done(), func() {
		ticker := time.NewTicker(voiceTimeFlushEvery)
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

// AddVoiceTime implements hub.VoiceTimeKeeper.
func (k *VoiceTime) AddVoiceTime(riders, together []string, seconds int) {
	k.mu.Lock()
	defer k.mu.Unlock()
	for _, id := range riders {
		k.riders[id] += int64(seconds)
	}
	for _, id := range together {
		k.together[id] += int64(seconds)
	}
}

func (k *VoiceTime) flush(ctx context.Context) {
	k.mu.Lock()
	riders, together := k.riders, k.together
	k.riders, k.together = make(map[string]int64), make(map[string]int64)
	k.mu.Unlock()
	lostRiders := k.write(ctx, riders, func(ctx context.Context, q *db.Queries, seconds int64, ids []pgtype.UUID) error {
		return q.AddVoiceSeconds(ctx, db.AddVoiceSecondsParams{Seconds: seconds, UserIds: ids})
	})
	lostTogether := k.write(ctx, together, func(ctx context.Context, q *db.Queries, seconds int64, ids []pgtype.UUID) error {
		return q.AddCrewTogether(ctx, db.AddCrewTogetherParams{Seconds: seconds, ChannelIds: ids})
	})
	k.mu.Lock()
	defer k.mu.Unlock()
	for id, seconds := range lostRiders {
		k.riders[id] += seconds
	}
	for id, seconds := range lostTogether {
		k.together[id] += seconds
	}
}

// write lands pending seconds a statement per distinct amount: one minute for
// everyone, almost always, so almost always one statement. What did not land
// comes back, for the next flush to try again.
func (k *VoiceTime) write(ctx context.Context, pending map[string]int64,
	add func(context.Context, *db.Queries, int64, []pgtype.UUID) error,
) map[string]int64 {
	bySeconds := make(map[int64][]string)
	for id, seconds := range pending {
		bySeconds[seconds] = append(bySeconds[seconds], id)
	}
	failed := make(map[string]int64)
	for seconds, names := range bySeconds {
		ids := make([]pgtype.UUID, 0, len(names))
		for _, name := range names {
			if id, err := store.ParseUUID(name); err == nil {
				ids = append(ids, id)
			}
		}
		write, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := add(write, k.store.Queries, seconds, ids)
		cancel()
		if err != nil {
			k.log.Warn("voice time not saved", "err", err, "rows", len(ids))
			for _, name := range names {
				failed[name] = seconds
			}
		}
	}
	return failed
}
