package notify

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// plan writes a session straight into the table: the API refuses the past and
// this test needs to place sessions on both sides of the reminder window.
func plan(t *testing.T, h *harness, name string, startsIn time.Duration) {
	t.Helper()
	if _, err := h.store.Pool.Exec(t.Context(),
		`insert into scheduled_sessions (room_id, workout_name, workout_json, starts_at, created_by)
		 values ($1, $2, '{}'::jsonb, now() + $3::interval, $4)`,
		h.room.ID, name, fmt.Sprintf("%d seconds", int(startsIn.Seconds())), h.planner.ID); err != nil {
		t.Fatalf("plan %s: %v", name, err)
	}
}

// The whole reminder, from the claim to the inbox: only what starts inside the
// hour is mailed, and only once however often the loop ticks.
func TestRemindDueMailsTheHourAheadOnce(t *testing.T) {
	h := setup(t)
	fake := &fakeResend{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	s := service(h, srv.URL)

	plan(t, h, "Openers", 30*time.Minute) // inside the window
	plan(t, h, "Leftovers", 3*time.Hour)  // too far out
	plan(t, h, "Yesterday", -2*time.Hour) // already been and gone

	s.remindDue(t.Context())

	// remindDue claims across every room, and `go test` runs packages in
	// parallel against one database — so count only what reached this
	// harness's rider rather than everything the fake saw.
	mine := fake.subjectsTo(h.email(h.optIn))
	if len(mine) != 1 {
		t.Fatalf("sent %d reminders, want exactly the one starting inside the hour: %v", len(mine), mine)
	}
	// Claimed thirty minutes ahead, and it says so (#1903) — "in an hour"
	// was the window's name, not the gap.
	if !strings.Contains(mine[0], "Openers") || !strings.Contains(mine[0], "in 30 minutes") {
		t.Fatalf("subject %q is not the reminder", mine[0])
	}

	// The claim is the update, so a second tick finds nothing left to send —
	// this is what a restart mid-send or a doubled ticker must not break.
	s.remindDue(t.Context())
	if again := fake.subjectsTo(h.email(h.optIn)); len(again) != 1 {
		t.Fatalf("a second pass sent %d more reminders: %v", len(again)-1, again)
	}
}

// A session moved past the reminder it already got is reminded again for its
// new time: the claim is keyed on reminded_at, and the move clears it. It used
// not to — riders got "Moved:" and then silence.
func TestAMovedSessionIsRemindedAgain(t *testing.T) {
	h := setup(t)
	fake := &fakeResend{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	s := service(h, srv.URL)

	plan(t, h, "Movers", 30*time.Minute)
	s.remindDue(t.Context())

	var id pgtype.UUID
	if err := h.store.Pool.QueryRow(t.Context(),
		`select id from scheduled_sessions where room_id = $1 and workout_name = 'Movers'`, h.room.ID).Scan(&id); err != nil {
		t.Fatalf("find the session: %v", err)
	}
	if _, err := h.store.Queries.RescheduleSession(t.Context(), db.RescheduleSessionParams{
		ID: id, RoomID: h.room.ID,
		StartsAt: pgtype.Timestamptz{Time: time.Now().Add(50 * time.Minute), Valid: true},
	}); err != nil {
		t.Fatalf("move: %v", err)
	}
	s.remindDue(t.Context())

	mine := fake.subjectsTo(h.email(h.optIn))
	if len(mine) != 2 {
		t.Fatalf("a moved session was reminded %d times, want one per start: %v", len(mine), mine)
	}
	// And each says how far off the start really is (#1903): the first was
	// claimed thirty minutes ahead, the second fifty — neither is "an hour".
	for i, want := range []string{"in 30 minutes", "in 50 minutes"} {
		if !strings.Contains(mine[i], want) {
			t.Errorf("reminder %d: %q does not say %q", i+1, mine[i], want)
		}
	}
}

// A plan already started is not reminded (#1905): the hour-before mail for a
// session the room is riding would be a mail about the past.
func TestAStartedPlanIsNotReminded(t *testing.T) {
	h := setup(t)
	fake := &fakeResend{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	s := service(h, srv.URL)

	plan(t, h, "Started Early", 30*time.Minute)
	if _, err := h.store.Pool.Exec(t.Context(),
		`update scheduled_sessions set started_at = now() where room_id = $1 and workout_name = 'Started Early'`, h.room.ID); err != nil {
		t.Fatalf("mark started: %v", err)
	}
	s.remindDue(t.Context())
	if mine := fake.subjectsTo(h.email(h.optIn)); len(mine) != 0 {
		t.Fatalf("a started plan was reminded: %v", mine)
	}
}

// A reminder names no wall-clock time, which is the entire reason it needs no
// per-rider timezone. If an absolute time creeps back into this mail, the zone
// question comes with it.
func TestReminderNamesNoClockTime(t *testing.T) {
	h := setup(t)
	fake := &fakeResend{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	s := service(h, srv.URL)

	starts := time.Now().Add(time.Hour)
	s.sessionMail(t.Context(), h.room, "Sweet Spot 2×20", starts, noActor, sessionReminder)

	if len(fake.payloads) != 1 {
		t.Fatalf("sent %d emails, want 1", len(fake.payloads))
	}
	p := fake.payloads[0]
	for _, part := range []string{fmt.Sprint(p["text"]), fmt.Sprint(p["html"])} {
		if strings.Contains(part, starts.Format("15:04")) || strings.Contains(part, starts.Format("2 Jan")) {
			t.Fatalf("a reminder named a clock time, which no zone makes right for everyone: %s", part)
		}
		if !strings.Contains(part, "in an hour") {
			t.Fatalf("a reminder did not say when: %s", part)
		}
	}
}

// The clock causes this one, not a rider, so nobody is excluded from it — and
// the zero actor must not be the NULL that silently empties the audience.
func TestReminderMailsEveryOptedInMember(t *testing.T) {
	h := setup(t)
	fake := &fakeResend{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	s := service(h, srv.URL)

	// The planner opted in too, so a reminder reaches them where a "planned"
	// mail would have skipped them.
	if _, err := h.store.Pool.Exec(t.Context(),
		"update users set email = $2, email_verified_at = now(), notify_planned = true where id = $1",
		h.planner.ID, h.email(h.planner)); err != nil {
		t.Fatalf("opt the planner in: %v", err)
	}

	s.sessionMail(t.Context(), h.room, "Openers", time.Now().Add(time.Hour), noActor, sessionReminder)

	if len(fake.payloads) != 2 {
		t.Fatalf("sent %d reminders, want both opted-in members", len(fake.payloads))
	}
}
