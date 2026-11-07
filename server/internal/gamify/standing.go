package gamify

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
)

// Standing is where a rider's level and rider streak go once a ride of theirs
// is judged: the hub, which copies them into every channel the rider stands
// in, so the cozy room can celebrate a level or a week gained. Defined here,
// where it is used; nil leaves the rooms at what the door read.
type Standing interface {
	SetStanding(riderID string, totalXp int64, streakWeeks int)
}

// SetStanding wires the hub in.
func (s *Service) SetStanding(to Standing) { s.standing = to }

// tellStanding reads what a saved ride moved and hands it over. It runs on
// the worker after the ride's achievements are judged, so a badge's XP is in
// the level too, and both savers reach it: a solo ride and a session's.
func (s *Service) tellStanding(ctx context.Context, userID pgtype.UUID) {
	if s.standing == nil {
		return
	}
	xp, err := s.store.Queries.UserTotalXp(ctx, userID)
	if err != nil {
		s.log.Warn("standing unreadable after a ride", "err", err, "rider", store.UUIDString(userID))
		return
	}
	streak := stats.RiderStreak(ctx, s.store.Queries, userID, s.now())
	s.standing.SetStanding(store.UUIDString(userID), xp, streak)
}
