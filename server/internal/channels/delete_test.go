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
