package gamify

import (
	"context"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/hub"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Session voice bonus (docs/SPEC.md XP sources, defaults — tune in alpha):
// paid to everyone who was in voice for at least half of a group session —
// one with at least two saved rides and ten minutes of timeline. Crew Chief
// counts the sessions a coach started with a medal-sized field.
const (
	SessionVoiceXP     = 5
	groupSessionRiders = 2
	groupSessionMinSec = 10 * 60
	crewChiefRiders    = 3
)

// SprintWon implements hub.XpKeeper: the win pays nothing itself and counts
// toward Sprint Snob.
func (s *Service) SprintWon(slug, riderID string, at time.Time) {
	s.enqueue("sprint", func(ctx context.Context) {
		s.record(ctx, riderID, sourceSprintWin, 0, slug+"@"+millis(at), at)
	})
}

// TrackPlayed implements hub.XpKeeper: a track the room let play to the end
// counts toward DJ for whoever queued it.
func (s *Service) TrackPlayed(slug, riderID, ref string, at time.Time) {
	s.enqueue("track", func(ctx context.Context) {
		s.record(ctx, riderID, sourceDjTrack, 0, slug+"/"+ref, at)
	})
}

// SessionClosed implements hub.XpKeeper.
func (s *Service) SessionClosed(ev hub.SessionClosed) {
	s.enqueue("session", func(ctx context.Context) { s.sessionClosed(ctx, ev) })
}

// RideSaved implements stats.RideKeeper — the ride is committed; judge it.
func (s *Service) RideSaved(userID pgtype.UUID, facts stats.RideFacts) {
	s.enqueue("ride", func(ctx context.Context) { s.rideSaved(ctx, userID, facts) })
}

func (s *Service) sessionClosed(ctx context.Context, ev hub.SessionClosed) {
	rode := 0
	for _, r := range ev.Riders {
		if r.Rode {
			rode++
		}
	}
	ref := ev.Slug + "@" + millis(ev.At)
	if rode >= groupSessionRiders && ev.Seconds >= groupSessionMinSec {
		for _, r := range ev.Riders {
			if r.VoiceSeconds*2 >= ev.Seconds {
				s.record(ctx, r.ID, sourceSession, SessionVoiceXP, ref, ev.At)
			}
		}
	}
	if ev.StartedBy != "" && rode >= crewChiefRiders {
		s.record(ctx, ev.StartedBy, sourceCoached, 0, ref, ev.At)
	}
}

// record writes one ledger row for a rider named by id and re-judges their
// achievements. A failure is logged and dropped: nothing upstream can act
// on it, and the next event tries again.
func (s *Service) record(ctx context.Context, riderID, source string, amount int, ref string, at time.Time) {
	userID, err := store.ParseUUID(riderID)
	if err != nil {
		return
	}
	_, err = s.store.Queries.AddXpEvent(ctx, db.AddXpEventParams{
		UserID: userID, Source: source, Amount: int32(amount), //nolint:gosec // SPEC-bounded amounts
		Ref: ref, At: pgtype.Timestamptz{Time: at, Valid: true},
	})
	if err != nil {
		s.log.Error("xp event failed", "err", err, "source", source, "rider", riderID)
		return
	}
	if err := s.evaluate(ctx, userID); err != nil {
		s.log.Error("achievement check failed", "err", err, "rider", riderID)
	}
}

func millis(at time.Time) string { return strconv.FormatInt(at.UnixMilli(), 10) }
