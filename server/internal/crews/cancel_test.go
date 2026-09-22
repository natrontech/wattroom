package crews

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// fakeNotifier records what scheduling asked the mailer to send.
type fakeNotifier struct {
	mu        sync.Mutex
	cancelled []string
	moved     []string
	// What each plan mail named: the crew and the channel (#2440).
	planned []plannedMail
}

type plannedMail struct {
	crew, channel pgtype.UUID
	workout       string
}

func (f *fakeNotifier) SessionPlanned(crew, channel pgtype.UUID, workoutName string, _ time.Time, _ pgtype.UUID) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.planned = append(f.planned, plannedMail{crew: crew, channel: channel, workout: workoutName})
}

func (f *fakeNotifier) plans(t *testing.T) []plannedMail {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]plannedMail(nil), f.planned...)
}

func (f *fakeNotifier) SessionRescheduled(_, _ pgtype.UUID, workoutName string, _ time.Time, _ pgtype.UUID) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.moved = append(f.moved, workoutName)
}

func (f *fakeNotifier) movedTo(t *testing.T) []string {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.moved...)
}

func (f *fakeNotifier) SessionCancelled(_, _ pgtype.UUID, workoutName string, _ time.Time, _ pgtype.UUID) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cancelled = append(f.cancelled, workoutName)
}

func (f *fakeNotifier) sent(t *testing.T) []string {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.cancelled...)
}

// Planning and moving a plan mail the crew, and so does cancelling one: a
// rider told to turn up at seven would otherwise find out by opening an
// empty channel (#839).
func TestCancellingAPlanMailsTheCrew(t *testing.T) {
	h := setup(t)
	notifier := &fakeNotifier{}
	h.svc.SetNotifier(notifier)
	crew := h.newCrew(t, "alice", "Planners")

	upcoming := h.planSession(t, "alice", crew, "Openers", time.Now().Add(2*time.Hour), "")
	if status, _ := h.call(t, "alice", http.MethodDelete, schedulePath(crew, "/", upcoming), ""); status != http.StatusNoContent {
		t.Fatalf("cancel: %d", status)
	}
	if got := notifier.sent(t); len(got) != 1 || got[0] != "Openers" {
		t.Fatalf("cancellations = %v, want one for Openers", got)
	}

	// A plan whose start has been and gone: the ride was already missed, and
	// saying it is cancelled now is noise. Planning refuses the past, so the
	// row has to be aged behind the API's back.
	stale := h.planSession(t, "alice", crew, "Leftovers", time.Now().Add(time.Hour), "")
	if _, err := h.store.Pool.Exec(t.Context(),
		"update scheduled_sessions set starts_at = now() - interval '1 hour' where id = $1", stale); err != nil {
		t.Fatalf("age the plan: %v", err)
	}
	if status, _ := h.call(t, "alice", http.MethodDelete, schedulePath(crew, "/", stale), ""); status != http.StatusNoContent {
		t.Fatalf("cancel stale: %d", status)
	}
	if got := notifier.sent(t); len(got) != 1 {
		t.Fatalf("cancellations = %v, want the stale one to have mailed nobody", got)
	}
}

// A move to the same time is not a move (#1639): it mails the crew nothing,
// where a real move mails it once.
func TestRescheduleToTheSameTimeMailsNobody(t *testing.T) {
	h := setup(t)
	notifier := &fakeNotifier{}
	h.svc.SetNotifier(notifier)
	crew := h.newCrew(t, "alice", "Movers")
	at := time.Now().Add(3 * time.Hour).UTC().Truncate(time.Second)
	id := h.planSession(t, "alice", crew, "Openers", at, "")

	same := fmt.Sprintf(`{"startsAt":%q}`, at.Format(time.RFC3339))
	if status, _ := h.call(t, "alice", http.MethodPatch, schedulePath(crew, "/", id), same); status != http.StatusNoContent {
		t.Fatalf("same-time move: %d", status)
	}
	if got := notifier.movedTo(t); len(got) != 0 {
		t.Fatalf("an unchanged time mailed %v", got)
	}
	later := fmt.Sprintf(`{"startsAt":%q}`, at.Add(time.Hour).Format(time.RFC3339))
	if status, _ := h.call(t, "alice", http.MethodPatch, schedulePath(crew, "/", id), later); status != http.StatusNoContent {
		t.Fatalf("real move: %d", status)
	}
	if got := notifier.movedTo(t); len(got) != 1 {
		t.Fatalf("a real move mails once, got %v", got)
	}
}
