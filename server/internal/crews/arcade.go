package crews

import (
	"cmp"
	"context"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// arcadeBoard is how many riders a board shows.
const arcadeBoard = 5

type arcadeEntry struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Score int32  `json:"score"`
}

type arcadeGame struct {
	// The crew's best ever, a rider once each.
	Top []arcadeEntry `json:"top"`
	// Today's daily course.
	Today []arcadeEntry `json:"today"`
	// The caller's own best ever, 0 before their first run.
	Best int32 `json:"best"`
}

type cupEntry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Wins int    `json:"wins"`
}

type arcadeView struct {
	// The UTC day the daily course is for, and the seed every crew plays it on.
	Day   string                `json:"day"`
	Seed  int64                 `json:"seed"`
	Games map[string]arcadeGame `json:"games"`
	// This week's cup: days won at each game since Monday, most first.
	Cup []cupEntry `json:"cup"`
}

// arcadeDay is the UTC day a run lands on, and its seed: the days since 1970,
// the same for every crew.
func arcadeDay(now time.Time) (time.Time, int64) {
	day := now.UTC().Truncate(24 * time.Hour)
	return day, day.Unix() / 86400
}

// arcadeWeek is the Monday the cup's week starts on, in UTC like the crew streak.
func arcadeWeek(day time.Time) time.Time {
	return day.AddDate(0, 0, -((int(day.Weekday()) + 6) % 7))
}

// bestFirst orders a board: the higher score, then who reached it first.
func bestFirst(a, b scored) int {
	return cmp.Or(cmp.Compare(b.score, a.score), a.at.Compare(b.at))
}

type scored struct {
	entry arcadeEntry
	score int32
	at    time.Time
}

func topOf(rows []scored) []arcadeEntry {
	slices.SortFunc(rows, bestFirst)
	out := make([]arcadeEntry, 0, min(len(rows), arcadeBoard))
	for _, r := range rows[:min(len(rows), arcadeBoard)] {
		out = append(out, r.entry)
	}
	return out
}

// arcadeOf builds the cabinet's boards from each rider's bests and the
// week's days. Every game in the closed set has a board, empty or not.
func arcadeOf(you string, day time.Time, bests []db.CrewArcadeBestsRow, week []db.CrewArcadeSinceRow, wins []db.CrewToeggeliTotalsRow) map[string]arcadeGame {
	top := map[string][]scored{}
	today := map[string][]scored{}
	own := map[string]int32{}
	for _, r := range bests {
		if r.Game == protocol.ArcadeToeggeli {
			continue
		}
		id := store.UUIDString(r.UserID)
		top[r.Game] = append(top[r.Game], scored{arcadeEntry{id, r.DisplayName, r.Score}, r.Score, r.SetAt.Time})
		if id == you {
			own[r.Game] = r.Score
		}
	}
	for _, r := range week {
		if r.Day.Time.Equal(day) {
			id := store.UUIDString(r.UserID)
			today[r.Game] = append(today[r.Game], scored{arcadeEntry{id, r.DisplayName, r.Score}, r.Score, r.SetAt.Time})
		}
	}
	// Töggeli's all-time board is every match won, not a rider's best day.
	for _, r := range wins {
		id := store.UUIDString(r.UserID)
		top[protocol.ArcadeToeggeli] = append(top[protocol.ArcadeToeggeli], scored{arcadeEntry{id, r.DisplayName, r.Wins}, r.Wins, r.SetAt.Time})
		if id == you {
			own[protocol.ArcadeToeggeli] = r.Wins
		}
	}
	games := make(map[string]arcadeGame, len(protocol.ArcadeMax))
	for game := range protocol.ArcadeMax {
		games[game] = arcadeGame{Top: topOf(top[game]), Today: topOf(today[game]), Best: own[game]}
	}
	return games
}

// cupOf counts the week's wins: at each game, each day's best run wins it,
// the earlier of two equal scores taking it, and every Töggeli match won is
// one more.
func cupOf(week []db.CrewArcadeSinceRow) []cupEntry {
	type key struct {
		game string
		day  time.Time
	}
	winner := map[key]db.CrewArcadeSinceRow{}
	wins := map[string]*cupEntry{}
	add := func(r db.CrewArcadeSinceRow, n int) {
		id := store.UUIDString(r.UserID)
		if wins[id] == nil {
			wins[id] = &cupEntry{ID: id, Name: r.DisplayName}
		}
		wins[id].Wins += n
	}
	for _, r := range week {
		if r.Game == protocol.ArcadeToeggeli {
			add(r, int(r.Score))
			continue
		}
		k := key{r.Game, r.Day.Time}
		w, ok := winner[k]
		if !ok || r.Score > w.Score || (r.Score == w.Score && r.SetAt.Time.Before(w.SetAt.Time)) {
			winner[k] = r
		}
	}
	for _, w := range winner {
		add(w, 1)
	}
	out := make([]cupEntry, 0, len(wins))
	for _, e := range wins {
		out = append(out, *e)
	}
	slices.SortFunc(out, func(a, b cupEntry) int {
		return cmp.Or(cmp.Compare(b.Wins, a.Wins), cmp.Compare(a.Name, b.Name))
	})
	return out
}

// handleCrewArcade: the cabinet's boards, for a member. Today's course and
// its seed come from the server's clock, so every crew rides the same one.
func (s *Service) handleCrewArcade(w http.ResponseWriter, r *http.Request) {
	crew, user, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	day, seed := arcadeDay(time.Now())
	bests, err := s.store.Queries.CrewArcadeBests(r.Context(), crew.ID)
	if err != nil {
		httpx.Fail(w, s.log, "arcade failed", err, "The high scores could not be loaded.", "crew", store.UUIDString(crew.ID))
		return
	}
	week, err := s.store.Queries.CrewArcadeSince(r.Context(), db.CrewArcadeSinceParams{
		CrewID: crew.ID, Since: pgtype.Date{Time: arcadeWeek(day), Valid: true},
	})
	if err != nil {
		httpx.Fail(w, s.log, "arcade week failed", err, "The high scores could not be loaded.", "crew", store.UUIDString(crew.ID))
		return
	}
	wins, err := s.store.Queries.CrewToeggeliTotals(r.Context(), crew.ID)
	if err != nil {
		httpx.Fail(w, s.log, "toeggeli wins failed", err, "The high scores could not be loaded.", "crew", store.UUIDString(crew.ID))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, arcadeView{
		Day:   day.Format(time.DateOnly),
		Seed:  seed,
		Games: arcadeOf(store.UUIDString(user.ID), day, bests, week, wins),
		Cup:   cupOf(week),
	})
}

// handleSaveArcadeScore: a rider's run on today's course. Only a better score
// of theirs that day lands, and a score is only ever paint, so the client's
// word is enough.
func (s *Service) handleSaveArcadeScore(w http.ResponseWriter, r *http.Request) {
	crew, user, _, ok := s.crewByID(w, r)
	if !ok {
		return
	}
	var req struct {
		Game  string `json:"game"`
		Score int32  `json:"score"`
	}
	if err := httpx.DecodeStrict(r, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request", "That request could not be read.")
		return
	}
	most, known := protocol.ArcadeMax[req.Game]
	if req.Game == protocol.ArcadeToeggeli {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "Töggeli's wins are counted at the table, not sent.", "game")
		return
	}
	if !known {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That game is not on the cabinet.", "game")
		return
	}
	if req.Score < 0 || req.Score > most {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error", "That score is off the machine.", "score")
		return
	}
	day, _ := arcadeDay(time.Now())
	err := s.store.Queries.SaveCrewArcadeScore(r.Context(), db.SaveCrewArcadeScoreParams{
		CrewID: crew.ID, Game: req.Game, UserID: user.ID, Score: req.Score,
		Day: pgtype.Date{Time: day, Valid: true},
	})
	if err != nil {
		httpx.Fail(w, s.log, "arcade save failed", err, "Your score could not be saved.", "crew", store.UUIDString(crew.ID))
		return
	}
	s.changed(r.Context(), crew.ID)
	w.WriteHeader(http.StatusNoContent)
}

// Won keeps a match won at a voice channel's table on its crew's board for
// the day, as the hub's ToeggeliKeeper. It returns at once; the write runs on
// its own goroutine, which ends with it.
func (s *Service) Won(channel, rider string) {
	channelID, errC := store.ParseUUID(channel)
	riderID, errR := store.ParseUUID(rider)
	if errC != nil || errR != nil {
		return
	}
	day, _ := arcadeDay(time.Now())
	safego.Go(s.log, "toeggeli win", func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		crew, err := s.store.Queries.AddCrewToeggeliWin(ctx, db.AddCrewToeggeliWinParams{
			UserID: riderID, Day: pgtype.Date{Time: day, Valid: true}, ChannelID: channelID,
		})
		if err != nil {
			s.log.Warn("toeggeli win not kept", "channel", channel, "rider", rider, "err", err)
			return
		}
		s.changed(ctx, crew)
	})
}
