package channels

import (
	"context"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Asking the gate again (#2808). The door asks mayEnter when a socket opens
// and when a voice token is minted, and at no other time. A change to the
// gate has to reach the sockets and calls that are already open: a channel
// made private, a crew role changed, the crew handed on. Otherwise a rider
// the gate now refuses keeps every tick, heart rate included, until they
// happen to disconnect, and a new owner stays refused their controls until
// they reconnect (#278).

// reauthorizeBudget bounds one asking. It is cut loose from the request that
// made the change, because an admin who closes the tab mid-sweep must not
// turn every lookup into a failure, and a failure evicts.
const reauthorizeBudget = 5 * time.Second

// reauthorize asks the gate again about each rider at each of some voice
// channels. It runs after the change that moved the gate has committed. A
// rider it refuses is evicted from the socket and the call. A rider it admits
// carries the role it answers. A lookup that fails refuses, as the unname
// always has: a door left open is the failure that leaks.
func (s *Service) reauthorize(ctx context.Context, at []db.Channel, riders []string) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), reauthorizeBudget)
	defer cancel()
	for _, c := range at {
		id := store.UUIDString(c.ID)
		for _, rider := range riders {
			role, admitted := "", false
			userID, err := store.ParseUUID(rider)
			if err == nil {
				role, admitted, err = s.standing(ctx, c, userID)
			}
			if err != nil {
				s.log.Error("asking the gate again failed", "err", err, "channel", id, "rider", rider)
			}
			if !admitted {
				s.evict(id, rider)
				continue
			}
			if s.live != nil {
				s.live.SetRole(id, rider, liveRole(role))
			}
		}
	}
}

// reauthorizeOccupants asks the gate again about everyone standing in a voice
// channel: the sweep after the channel itself changed.
func (s *Service) reauthorizeOccupants(ctx context.Context, c db.Channel) {
	if s.live == nil || c.Kind != kindVoice {
		return
	}
	s.reauthorize(ctx, []db.Channel{c}, s.live.Occupants(store.UUIDString(c.ID)))
}

// Reauthorize asks the gate again about one rider in every voice channel of a
// crew, which a crew role change or a hand-over calls once it has committed.
// A promotion reaches the controls on the sockets already open. A demotion
// takes them out of the private channels that do not name them.
func (s *Service) Reauthorize(ctx context.Context, crewID, userID pgtype.UUID) {
	rows, err := s.store.Queries.ListCrewChannels(context.WithoutCancel(ctx), crewID)
	if err != nil {
		s.log.Error("crew channels lookup failed", "err", err, "crew", store.UUIDString(crewID))
		return
	}
	voice := slices.DeleteFunc(rows, func(c db.Channel) bool { return c.Kind != kindVoice })
	s.reauthorize(ctx, voice, []string{store.UUIDString(userID)})
}
