package rooms

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// fakeNotifier records what scheduling asked the mailer to send.
type fakeNotifier struct {
	mu        sync.Mutex
	cancelled []string
}

func (f *fakeNotifier) SessionPlanned(db.Room, string, time.Time, pgtype.UUID)     {}
func (f *fakeNotifier) SessionRescheduled(db.Room, string, time.Time, pgtype.UUID) {}

func (f *fakeNotifier) SessionCancelled(_ db.Room, workoutName string, _ time.Time, _ pgtype.UUID) {
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

// Planning mails the room and moving a plan mails the room; removing one used
// to mail nobody, so riders told to turn up at seven found out by opening an
// empty room (#839).
func TestUnscheduleMailsTheRoom(t *testing.T) {
	h := setup(t)
	notifier := &fakeNotifier{}
	h.svc.SetNotifier(notifier)
	slug, _ := h.createRoom(t, "alice", "Planners")

	plan := func(name string, at time.Time) string {
		t.Helper()
		workout := `{\"name\":\"` + name + `\",\"steps\":[{\"type\":\"steady\",\"seconds\":600,\"target\":0.75}]}`
		body := fmt.Sprintf(`{"workoutName":%q,"workoutJson":"%s","startsAt":%q}`,
			name, workout, at.UTC().Format(time.RFC3339))
		status, got := h.call(t, "alice", http.MethodPost, "/api/rooms/"+slug+"/schedule", body)
		if status != http.StatusCreated {
			t.Fatalf("schedule %s: %d %v", name, status, got)
		}
		id, _ := got["id"].(string)
		return id
	}

	upcoming := plan("Openers", time.Now().Add(2*time.Hour))
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug+"/schedule/"+upcoming, ""); status != http.StatusNoContent {
		t.Fatalf("unschedule: %d", status)
	}
	if got := notifier.sent(t); len(got) != 1 || got[0] != "Openers" {
		t.Fatalf("cancellations = %v, want one for Openers", got)
	}

	// A plan whose start has been and gone: the ride was already missed, and
	// saying it is cancelled now is noise. Planning refuses the past, so the
	// row has to be aged behind the API's back.
	stale := plan("Leftovers", time.Now().Add(time.Hour))
	if _, err := h.store.Pool.Exec(t.Context(),
		"update scheduled_sessions set starts_at = now() - interval '1 hour' where id = $1", stale); err != nil {
		t.Fatalf("age the plan: %v", err)
	}
	if status, _ := h.call(t, "alice", http.MethodDelete, "/api/rooms/"+slug+"/schedule/"+stale, ""); status != http.StatusNoContent {
		t.Fatalf("unschedule stale: %d", status)
	}
	if got := notifier.sent(t); len(got) != 1 {
		t.Fatalf("cancellations = %v, want the stale one to have mailed nobody", got)
	}
}
