package gamify

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Ride achievement thresholds and the clock hours (docs/SPEC.md, defaults —
// tune in alpha). Clock times are read in the RIDER's zone (#2063): Sunrise
// Club is about getting up early, which is a fact about where the rider is,
// and the server's zone made 07:30 in Zurich an early ride and 07:30 in
// Denver a late one.
const (
	sufferfestSec  = 45 * 60
	hotEndSec      = 3 * 60
	espressoMaxSec = 25 * 60
	espressoPct    = 80
	sunriseHour    = 7
	nightHour      = 23
)

// tallies is everything the server can count about one rider, in four
// queries — the trophy case's read and the achievements' judge alike.
type tallies struct {
	rides, kj, rideXp int64
	sunrise, night    int
	bySource          map[string]db.XpBySourceRow
	medals            map[string]int64
	earned            map[string]time.Time
}

func (s *Service) tally(ctx context.Context, userID pgtype.UUID) (*tallies, error) {
	q := s.store.Queries
	rides, err := q.UserRideTally(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("gamify: ride tally: %w", err)
	}
	times, err := q.ListUserRideTimes(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("gamify: ride times: %w", err)
	}
	sources, err := q.XpBySource(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("gamify: xp by source: %w", err)
	}
	medals, err := q.UserMedalTally(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("gamify: medals: %w", err)
	}
	earned, err := q.ListUserAchievements(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("gamify: achievements: %w", err)
	}
	// The rider's own clock (#2063). Nullable, and a rider whose browser
	// never told us reads as UTC — stats.Zone decides that, here and in the
	// streak, so the two never disagree.
	tz, err := q.UserTimezone(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("gamify: timezone: %w", err)
	}
	t := &tallies{
		rides: rides.Rides, kj: rides.Kj, rideXp: rides.Xp,
		bySource: make(map[string]db.XpBySourceRow, len(sources)),
		medals:   make(map[string]int64, len(medals)),
		earned:   make(map[string]time.Time, len(earned)),
	}
	t.sunrise, t.night = clockCounts(times, stats.Zone(tz))
	for _, row := range sources {
		t.bySource[row.Source] = row
	}
	for _, row := range medals {
		t.medals[row.Kind] = row.N
	}
	for _, row := range earned {
		t.earned[row.Key] = row.EarnedAt.Time
	}
	return t, nil
}

// clockCounts is Sunrise Club and Night Shift's arithmetic: rides that
// started before seven, rides that ended after eleven at night — where
// "ended after 23:00" includes a ride that ran past midnight.
func clockCounts(rows []db.ListUserRideTimesRow, loc *time.Location) (sunrise, night int) {
	for _, row := range rows {
		start := row.StartedAt.Time.In(loc)
		end := start.Add(time.Duration(row.Seconds) * time.Second)
		if start.Hour() < sunriseHour {
			sunrise++
		}
		if end.Hour() >= nightHour || end.YearDay() != start.YearDay() || end.Year() != start.Year() {
			night++
		}
	}
	return sunrise, night
}

// The four social counts, each read as a ROW COUNT. docs/SPEC.md records
// lounge blocks past the daily cap at 0 XP so the hours keep counting, and
// pays sprint wins, DJ tracks and coached sessions 0 always — summed, all
// four would read as nothing. They live here because `have()` judges the
// badge from them and the trophy case displays them, and the two disagreeing
// is a bug nobody would see: the profile draws the count and its own badge's
// annotation side by side.
func (t *tallies) voiceMinutes() int64 { return t.bySource[sourceLounge].N * blockMinutes }
func (t *tallies) tracksPlayed() int64 { return t.bySource[sourceDjTrack].N }
func (t *tallies) coached() int64      { return t.bySource[sourceCoached].N }
func (t *tallies) sprintWins() int64   { return t.bySource[sourceSprintWin].N }

// voiceSessions is group sessions the rider was IN VOICE for at least half of
// — that is the row events.go writes, and calling it "group sessions" would
// read a voice-off rider's twenty sessions as zero.
func (t *tallies) voiceSessions() int64 { return t.bySource[sourceSession].N }

// have is how far along a counted achievement the rider is; false for the
// ride achievements, which have no count.
func (t *tallies) have(key string) (int, bool) {
	switch key {
	case keySunrise:
		return t.sunrise, true
	case keyNightShift:
		return t.night, true
	case key200Rides:
		return int(t.rides), true
	case keyLounge:
		return int(t.voiceMinutes()), true
	case keyDJ:
		return int(t.tracksPlayed()), true
	case keyCrewChief:
		return int(t.coached()), true
	case keySprintSnob:
		return int(t.sprintWins()), true
	}
	return 0, false
}

// evaluate awards every counted achievement the rider has reached and not
// yet earned. Runs after each ledger row — a handful of reads per event.
func (s *Service) evaluate(ctx context.Context, userID pgtype.UUID) error {
	t, err := s.tally(ctx, userID)
	if err != nil {
		return err
	}
	for _, a := range Catalogue {
		if a.Need == 0 {
			continue
		}
		if _, done := t.earned[a.Key]; done {
			continue
		}
		if have, _ := t.have(a.Key); have >= a.Need {
			if err := s.award(ctx, userID, a); err != nil {
				return err
			}
		}
	}
	return nil
}

// award records the achievement and pays it in one transaction; an
// achievement already on the shelf pays nothing — the primary key and the
// ledger's (user, source, ref) both refuse a second copy.
func (s *Service) award(ctx context.Context, userID pgtype.UUID, a Achievement) error {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("gamify: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.store.Queries.WithTx(tx)
	at := pgtype.Timestamptz{Time: s.now(), Valid: true}
	n, err := q.AwardAchievement(ctx, db.AwardAchievementParams{UserID: userID, Key: a.Key, EarnedAt: at})
	if err != nil {
		return fmt.Errorf("gamify: award %s: %w", a.Key, err)
	}
	if n == 0 {
		return nil
	}
	_, err = q.AddXpEvent(ctx, db.AddXpEventParams{
		UserID: userID, Source: sourceAchievement, Amount: int32(a.XP), //nolint:gosec // 100–500
		Ref: a.Key, At: at,
	})
	if err != nil {
		return fmt.Errorf("gamify: pay %s: %w", a.Key, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("gamify: commit: %w", err)
	}
	s.log.Info("achievement earned", "rider", store.UUIDString(userID), "key", a.Key)
	return nil
}

// rideAchievements judges one saved ride against the per-ride entries.
func rideAchievements(f stats.RideFacts) []string {
	var keys []string
	if f.AboveFtpSec >= sufferfestSec {
		keys = append(keys, keySufferfest)
	}
	if f.Z6Sec >= hotEndSec {
		keys = append(keys, keyHotEnd)
	}
	if f.Seconds > 0 && f.Seconds < espressoMaxSec && f.AboveSweetSpotSec*100 >= espressoPct*f.Seconds {
		keys = append(keys, keyEspresso)
	}
	return keys
}

func (s *Service) rideSaved(ctx context.Context, userID pgtype.UUID, f stats.RideFacts) {
	for _, key := range rideAchievements(f) {
		a, ok := byKey(key)
		if !ok {
			continue
		}
		if err := s.award(ctx, userID, a); err != nil {
			s.log.Error("ride achievement failed", "err", err, "key", key)
		}
	}
	if err := s.evaluate(ctx, userID); err != nil {
		s.log.Error("achievement check failed", "err", err, "rider", store.UUIDString(userID))
	}
}
