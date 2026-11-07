package crews

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

func TestArcadeSavesBestPerGameAndDay(t *testing.T) {
	h := setup(t)
	crew := crewWith(t, h)
	post := func(body string) int {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/crews/"+crew+"/arcade", strings.NewReader(body))
		req.Header.Set("X-Test-User", "alice")
		w := httptest.NewRecorder()
		h.mux.ServeHTTP(w, req)
		return w.Code
	}
	for _, tc := range []struct {
		body string
		want int
	}{
		{`{"game":"bergpreis","score":300}`, http.StatusNoContent},
		{`{"game":"bergpreis","score":120}`, http.StatusNoContent},
		{`{"game":"darts","score":95}`, http.StatusNoContent},
		{`{"game":"darts","score":181}`, http.StatusBadRequest},
		{`{"game":"bergpreis","score":99999}`, http.StatusBadRequest},
		{`{"game":"pinball","score":10}`, http.StatusBadRequest},
		{`{"score":10}`, http.StatusBadRequest},
		{`{"game":"feedzone","score":-1}`, http.StatusBadRequest},
		{`{"game":"toeggeli","score":3}`, http.StatusBadRequest},
	} {
		if got := post(tc.body); got != tc.want {
			t.Errorf("%s: %d, want %d", tc.body, got, tc.want)
		}
	}
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/crews/"+crew+"/arcade", nil)
	req.Header.Set("X-Test-User", "alice")
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	var out arcadeView
	if err := json.NewDecoder(w.Body).Decode(&out); err != nil {
		t.Fatalf("decoding the cabinet: %v", err)
	}
	day, seed := arcadeDay(time.Now())
	if out.Day != day.Format(time.DateOnly) || out.Seed != seed {
		t.Errorf("course %s/%d, want %s/%d", out.Day, out.Seed, day.Format(time.DateOnly), seed)
	}
	berg := out.Games["bergpreis"]
	if len(berg.Top) != 1 || berg.Top[0].Score != 300 || berg.Best != 300 || len(berg.Today) != 1 {
		t.Errorf("bergpreis holds %+v", berg)
	}
	if feed, ok := out.Games["feedzone"]; !ok || len(feed.Top) != 0 || feed.Top == nil {
		t.Errorf("an unplayed game still has an empty board: %+v", feed)
	}
	if len(out.Cup) != 1 || out.Cup[0].Wins != 2 {
		t.Errorf("two games won today: %+v", out.Cup)
	}
}

func TestArcadeWeekStartsMonday(t *testing.T) {
	for _, tc := range []struct{ day, monday string }{
		{"2026-11-09", "2026-11-09"}, // a Monday
		{"2026-11-07", "2026-11-02"}, // a Saturday
		{"2026-11-08", "2026-11-02"}, // a Sunday
	} {
		day, _ := time.Parse(time.DateOnly, tc.day)
		if got := arcadeWeek(day).Format(time.DateOnly); got != tc.monday {
			t.Errorf("%s: week from %s, want %s", tc.day, got, tc.monday)
		}
	}
}

func TestCupCountsDaysWon(t *testing.T) {
	alice, bob := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}, pgtype.UUID{Bytes: [16]byte{2}, Valid: true}
	at := func(day string, minute int) (pgtype.Date, pgtype.Timestamptz) {
		d, _ := time.Parse(time.DateOnly, day)
		return pgtype.Date{Time: d, Valid: true}, pgtype.Timestamptz{Time: d.Add(time.Duration(minute) * time.Minute), Valid: true}
	}
	row := func(game string, who pgtype.UUID, name, day string, minute int, score int32) db.CrewArcadeSinceRow {
		d, ts := at(day, minute)
		return db.CrewArcadeSinceRow{Game: game, UserID: who, DisplayName: name, Day: d, Score: score, SetAt: ts}
	}
	cup := cupOf([]db.CrewArcadeSinceRow{
		row("bergpreis", alice, "Alice", "2026-11-02", 1, 500),
		row("bergpreis", bob, "Bob", "2026-11-02", 2, 400),
		row("bergpreis", bob, "Bob", "2026-11-03", 1, 700),
		// A tie goes to whoever got there first.
		row("darts", alice, "Alice", "2026-11-03", 5, 60),
		row("darts", bob, "Bob", "2026-11-03", 4, 60),
		row("feedzone", bob, "Bob", "2026-11-04", 1, 90),
		// Every match won at the table counts, not just the day's most.
		row("toeggeli", alice, "Alice", "2026-11-04", 1, 3),
		row("toeggeli", bob, "Bob", "2026-11-04", 2, 1),
	})
	if len(cup) != 2 || cup[0].Name != "Alice" || cup[0].Wins != 4 || cup[1].Wins != 4 {
		t.Errorf("cup %+v, want Alice 4, Bob 4, by name on a tie", cup)
	}
}
