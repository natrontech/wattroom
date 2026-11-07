package crews

import (
	"cmp"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
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
func arcadeOf(you string, day time.Time, bests []db.CrewArcadeBestsRow, week []db.CrewArcadeSinceRow) map[string]arcadeGame {
	top := map[string][]scored{}
	today := map[string][]scored{}
	own := map[string]int32{}
	for _, r := range bests {
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
	games := make(map[string]arcadeGame, len(protocol.ArcadeMax))
	for game := range protocol.ArcadeMax {
		games[game] = arcadeGame{Top: topOf(top[game]), Today: topOf(today[game]), Best: own[game]}
	}
	return games
}

// cupOf counts the week's days won: at each game, each day's best run wins
// it, the earlier of two equal scores taking it.
func cupOf(week []db.CrewArcadeSinceRow) []cupEntry {
	type key struct {
		game string
		day  time.Time
	}
	winner := map[key]db.CrewArcadeSinceRow{}
	for _, r := range week {
		k := key{r.Game, r.Day.Time}
		w, ok := winner[k]
		if !ok || r.Score > w.Score || (r.Score == w.Score && r.SetAt.Time.Before(w.SetAt.Time)) {
			winner[k] = r
		}
	}
	wins := map[string]*cupEntry{}
	for _, w := range winner {
		id := store.UUIDString(w.UserID)
		if wins[id] == nil {
			wins[id] = &cupEntry{ID: id, Name: w.DisplayName}
		}
		wins[id].Wins++
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
	httpx.WriteJSON(w, http.StatusOK, arcadeView{
		Day:   day.Format(time.DateOnly),
		Seed:  seed,
		Games: arcadeOf(store.UUIDString(user.ID), day, bests, week),
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
