package wardrobe

import (
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The two moving feasts land on the days they were held.
func TestTheMovingFeastsLandOnTheirDays(t *testing.T) {
	for _, tc := range []struct {
		name string
		got  time.Time
		want string
	}{
		{"Morgestraich 2024", morgestraich(2024), "2024-02-19"},
		{"Morgestraich 2025", morgestraich(2025), "2025-03-10"},
		{"Morgestraich 2026", morgestraich(2026), "2026-02-23"},
		{"Sechseläuten 2026, the third Monday", sechselaeuten(2026), "2026-04-20"},
		{"Sechseläuten 2019, out of Holy Week", sechselaeuten(2019), "2019-04-08"},
		{"Sechseläuten 2025, off Easter Monday", sechselaeuten(2025), "2025-04-28"},
		{"Sechseläuten 2022, off Easter Monday", sechselaeuten(2022), "2022-04-25"},
	} {
		if got := tc.got.Format(time.DateOnly); got != tc.want {
			t.Errorf("%s: %s, want %s", tc.name, got, tc.want)
		}
	}
}

// A window is the rider's calendar: the same instant is inside it in one
// zone and outside it in another.
func TestAWindowIsTheRidersCalendar(t *testing.T) {
	zurich, err := time.LoadLocation("Europe/Zurich")
	if err != nil {
		t.Fatal(err)
	}
	keys := func(at time.Time) []string {
		var k []string
		for _, w := range windowsHolding(at) {
			k = append(k, w.key)
		}
		return k
	}
	for _, tc := range []struct {
		name string
		at   time.Time
		want []string
	}{
		{"1 August's first day", time.Date(2026, 7, 29, 0, 0, 0, 0, zurich), []string{"1-august"}},
		{"1 August's last minute", time.Date(2026, 8, 4, 23, 59, 0, 0, zurich), []string{"1-august"}},
		{"the day after", time.Date(2026, 8, 5, 0, 0, 0, 0, zurich), nil},
		{"half past midnight on 5 March in Zurich", time.Date(2026, 3, 5, 0, 30, 0, 0, zurich), nil},
		{"the same instant in UTC", time.Date(2026, 3, 5, 0, 30, 0, 0, zurich).UTC(), []string{"chalandamarz"}},
		{"Fasnacht and Chalandamarz share 26 February 2026", time.Date(2026, 2, 26, 12, 0, 0, 0, zurich), []string{"fasnacht", "chalandamarz"}},
		{"all of October", time.Date(2026, 10, 31, 23, 0, 0, 0, zurich), []string{"alpabzug"}},
	} {
		if got := keys(tc.at); !slices.Equal(got, tc.want) {
			t.Errorf("%s: %v, want %v", tc.name, got, tc.want)
		}
	}
}

// Every seasonal item in the catalogue has a window to be earned in, and
// every window earns something: an item with no window could never be had.
func TestEverySeasonHasItsItemsAndEveryItemItsSeason(t *testing.T) {
	var keys []string
	for _, s := range seasons {
		keys = append(keys, s.key)
		if len(seasonItems[s.key]) == 0 {
			t.Errorf("the %s window earns nothing", s.key)
		}
	}
	for key := range seasonItems {
		if !slices.Contains(keys, key) {
			t.Errorf("earned:season:%s has no window", key)
		}
	}
	if len(seasons) != 8 {
		t.Errorf("%d windows, want docs/SPEC.md's 8", len(seasons))
	}
}

// A seasonal item is never sold (ADR-0069): it has no price, and the shop
// refuses it.
func TestASeasonalItemIsNotBuyable(t *testing.T) {
	h := setup(t)
	h.earn(t, "alice", 10_000)
	for _, ids := range seasonItems {
		for _, id := range ids {
			it, _ := Lookup(id)
			if it.Kind() != "earn" || it.Price() != 0 {
				t.Errorf("%s: kind %q at %d Batzen, want earned at none", id, it.Kind(), it.Price())
			}
			if status, body := h.call(t, "alice", http.MethodPost, "/api/me/wardrobe/"+id, ""); status != http.StatusBadRequest || body["message"] != "Earned, not sold." {
				t.Errorf("buying %s: %d %v, want 400 Earned, not sold.", id, status, body)
			}
		}
	}
}

// Missing a window loses a year, never the item: two rides in Alpabzug 2026
// earn nothing, count for nothing in 2027, and three in 2027 earn the crown,
// first earned 2027. A fourth ride, or another year's three, keeps that date.
func TestEarningIn2027AfterMissing2026(t *testing.T) {
	h := setup(t)
	alice := h.id("alice")
	ride := func(at time.Time) {
		t.Helper()
		start := pgtype.Timestamptz{Time: at, Valid: true}
		if _, err := h.st.Queries.CreateRide(t.Context(), db.CreateRideParams{
			UserID: alice, WorkoutName: "Alpabzug", StartedAt: start,
			Seconds: 3600, AvgWatts: 200, Kj: 720, Execution: 0.9, FtpWatts: 250, Samples: []byte("x"), Curve: []byte(`{}`),
		}); err != nil {
			t.Fatal(err)
		}
		if err := RideSaved(t.Context(), h.st.Queries, alice, at); err != nil {
			t.Fatal(err)
		}
	}
	earned := func() (db.GetWardrobeItemRow, bool) {
		t.Helper()
		row, err := h.st.Queries.GetWardrobeItem(t.Context(), db.GetWardrobeItemParams{UserID: alice, ItemID: "deco.flowers"})
		return row, err == nil
	}

	ride(time.Date(2026, 9, 5, 18, 0, 0, 0, time.UTC))
	ride(time.Date(2026, 10, 20, 18, 0, 0, 0, time.UTC))
	ride(time.Date(2026, 11, 2, 18, 0, 0, 0, time.UTC)) // after the window
	if _, ok := earned(); ok {
		t.Fatal("earned with two rides in the 2026 window")
	}
	ride(time.Date(2027, 9, 1, 7, 0, 0, 0, time.UTC))
	ride(time.Date(2027, 9, 8, 7, 0, 0, 0, time.UTC))
	if _, ok := earned(); ok {
		t.Fatal("2026's rides counted towards 2027")
	}
	third := time.Date(2027, 10, 31, 7, 0, 0, 0, time.UTC)
	ride(third)
	row, ok := earned()
	if !ok || row.Source != "earned" || !row.AcquiredAt.Time.Equal(third) {
		t.Fatalf("after three rides in 2027: %+v (owned %v), want earned on the third", row, ok)
	}
	ride(time.Date(2028, 9, 1, 7, 0, 0, 0, time.UTC))
	ride(time.Date(2028, 9, 2, 7, 0, 0, 0, time.UTC))
	ride(time.Date(2028, 9, 3, 7, 0, 0, 0, time.UTC))
	if again, _ := earned(); !again.AcquiredAt.Time.Equal(third) {
		t.Errorf("earned again in 2028: first earned %v, want %v kept", again.AcquiredAt.Time, third)
	}
}
