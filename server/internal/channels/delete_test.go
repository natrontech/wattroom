package channels

import (
	"context"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// cancelled records the plans a delete called off, and whether their channel
// still stood when it did: the mail reads whom the channel admits (#2610).
type cancelled struct {
	st       *store.Store
	workouts []string
	stood    []bool
}

func (c *cancelled) SessionCancelled(_, channel pgtype.UUID, workoutName string, _ time.Time, _ pgtype.UUID) {
	var n int
	_ = c.st.Pool.QueryRow(context.Background(), "select count(*) from channels where id = $1", channel).Scan(&n)
	c.workouts = append(c.workouts, workoutName)
	c.stood = append(c.stood, n == 1)
}

// A private channel's plans went on without it, opened to the whole crew and
// its shared feed: the foreign key nulls a plan's channel, and a plan naming
// none is everybody's (#2610). An open channel's plans keep their slot.
func TestDeletingAPrivateChannelCancelsItsPlans(t *testing.T) {
	h := setup(t)
	mail := &cancelled{st: h.store}
	h.svc.SetNotifier(mail)
	crewID, _ := store.ParseUUID(h.crew)
	plan := func(channel, workout string, in time.Duration) pgtype.UUID {
		t.Helper()
		ch, _ := store.ParseUUID(channel)
		row, err := h.store.Queries.CreateCrewPlan(t.Context(), db.CreateCrewPlanParams{
			CrewID: crewID, ChannelID: ch, WorkoutName: workout, WorkoutJson: []byte(`{}`),
			StartsAt:  pgtype.Timestamptz{Time: time.Now().Add(in), Valid: true},
			CreatedBy: h.users.ByToken["alice"].ID,
		})
		if err != nil {
			t.Fatalf("plan %s: %v", workout, err)
		}
		return row.ID
	}
	private := h.create(t, "voice", "Coaches", true)
	open := h.create(t, "voice", "Pain Cave", false)
	upcoming := plan(private, "Coaches Only", time.Hour)
	gone := plan(private, "Last Week", -7*24*time.Hour)
	kept := plan(open, "Crew Ride", time.Hour)

	if status, _ := h.call(t, "dave", http.MethodDelete, "/api/channels/"+private, ""); status != http.StatusNoContent {
		t.Fatalf("an admin deletes a private channel: %d", status)
	}
	var left int
	if err := h.store.Pool.QueryRow(t.Context(),
		`select count(*) from scheduled_sessions where id = any($1)`, []pgtype.UUID{upcoming, gone}).Scan(&left); err != nil {
		t.Fatalf("count: %v", err)
	}
	if left != 0 {
		t.Errorf("%d of the private channel's plans outlived it, open to the crew", left)
	}
	// Only the one still to come is news (#839).
	if !slices.Equal(mail.workouts, []string{"Coaches Only"}) || !slices.Equal(mail.stood, []bool{true}) {
		t.Errorf("cancellations %v, channel standing %v; want the upcoming plan, told while the channel stood",
			mail.workouts, mail.stood)
	}

	if status, _ := h.call(t, "dave", http.MethodDelete, "/api/channels/"+open, ""); status != http.StatusNoContent {
		t.Fatalf("an admin deletes an open channel: %d", status)
	}
	var channel pgtype.UUID
	if err := h.store.Pool.QueryRow(t.Context(),
		`select channel_id from scheduled_sessions where id = $1`, kept).Scan(&channel); err != nil {
		t.Fatalf("an open channel's plan went with it: %v", err)
	}
	if channel.Valid || len(mail.workouts) != 1 {
		t.Errorf("an open channel's plan: channel %v, cancellations %v; want kept with no channel, no mail",
			channel, mail.workouts)
	}
}

// A crew's last channel, deleted by an owner nobody else is in the crew with,
// takes the crew (#1935, #2837): it has nothing left in it, and until now its
// founder could neither leave it, hand it on nor delete it — the crew held a
// founding slot for good. A banned row is not somebody in the crew, and a
// crew with anyone else in it keeps its name, logo and code.
func TestDeletingTheLastChannelOfACrewNobodyElseIsInTakesTheCrew(t *testing.T) {
	for _, tc := range []struct {
		name   string
		keep   []string // who, besides the owner and banned erin, stays in the crew
		gone   bool
		reason string
	}{
		{"alone", nil, true, "the crew outlived its last channel with nobody but its owner in it"},
		{"with bob", []string{"bob"}, false, "the crew went with its last channel while bob was still in it"},
		{"with an admin", []string{"dave"}, false, "the crew went with its last channel while dave was still in it"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := setup(t)
			crewID, _ := store.ParseUUID(h.crew)
			if _, err := h.store.Pool.Exec(t.Context(),
				`delete from crew_roles where crew_id = $1 and role in ('member', 'admin') and not (user_id = any($2))`,
				crewID, h.ids(tc.keep)); err != nil {
				t.Fatalf("empty the crew: %v", err)
			}
			first := h.create(t, "text", "Banter", false)
			last := h.create(t, "voice", "Pain Cave", false)

			if status, _ := h.call(t, "alice", http.MethodDelete, "/api/channels/"+first, ""); status != http.StatusNoContent {
				t.Fatalf("delete the first channel: %d", status)
			}
			if h.crewGone(t, crewID) {
				t.Fatal("the crew went with a channel while another was left")
			}
			if status, _ := h.call(t, "alice", http.MethodDelete, "/api/channels/"+last, ""); status != http.StatusNoContent {
				t.Fatalf("delete the last channel: %d", status)
			}
			if h.crewGone(t, crewID) != tc.gone {
				t.Fatal(tc.reason)
			}
		})
	}
}

// ids is the account ids of the named riders.
func (h *harness) ids(names []string) []pgtype.UUID {
	out := make([]pgtype.UUID, 0, len(names))
	for _, n := range names {
		out = append(out, h.users.ByToken[n].ID)
	}
	return out
}

// crewGone reads whether the crew row is gone, failing on any other answer.
func (h *harness) crewGone(t *testing.T, crew pgtype.UUID) bool {
	t.Helper()
	var n int
	if err := h.store.Pool.QueryRow(t.Context(), "select count(*) from crews where id = $1", crew).Scan(&n); err != nil {
		t.Fatalf("crew read: %v", err)
	}
	return n == 0
}
