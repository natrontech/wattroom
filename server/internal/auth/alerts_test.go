package auth

import (
	"net/http"
	"strings"
	"testing"
)

// The alert that motivates the whole class (#840): moving the recovery address
// has to reach the address losing it, which is the one the confirmation link
// is about to overwrite.
func TestVerifyEmailAlertsTheAddressBeingReplaced(t *testing.T) {
	s := testService(t)
	user, mailer := verifiable(t, s, "first@example.test")
	if w := confirm(t, s, mailer.token(t)); w.Code != http.StatusOK {
		t.Fatalf("first confirm = %d: %s", w.Code, w.Body.String())
	}
	// A first confirmation replaces nothing, and there is nobody to tell.
	if got := mailer.sent(t); len(got) != 0 {
		t.Fatalf("first confirmation alerted %+v", got)
	}

	current, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("read user: %v", err)
	}
	if _, err := s.startEmailVerification(t.Context(), current, "second@example.test"); err != nil {
		t.Fatalf("start second verification: %v", err)
	}
	if w := confirm(t, s, mailer.token(t)); w.Code != http.StatusOK {
		t.Fatalf("second confirm = %d: %s", w.Code, w.Body.String())
	}

	got := mailer.sent(t)
	if len(got) != 1 {
		t.Fatalf("alerts = %+v, want exactly one", got)
	}
	if got[0].to != "first@example.test" {
		t.Fatalf("alert went to %q, want the address being replaced", got[0].to)
	}
	if !strings.Contains(got[0].line, "second@example.test") {
		t.Fatalf("alert %q does not say where the account went", got[0].line)
	}
}

// One representative of the credential-set triggers: they all run through the
// same alert, so what this proves for a disconnect holds for the rest.
func TestDisconnectProviderAlertsTheRider(t *testing.T) {
	s := testService(t)
	mailer := &fakeMailer{}
	s.SetMailer(mailer)
	user := testUser(t, s)
	if _, err := s.store.Pool.Exec(t.Context(),
		"update users set email = $2, email_verified_at = now() where id = $1",
		user.ID, "rider@example.test"); err != nil {
		t.Fatalf("verify address: %v", err)
	}
	cookie := signedIn(t, s, user)
	linkIdentity(t, s, user, "github", "alert-github")
	linkIdentity(t, s, user, "google", "alert-google")

	if w := disconnect(t, s, cookie, "github"); w.Code != http.StatusNoContent {
		t.Fatalf("disconnect = %d: %s", w.Code, w.Body.String())
	}

	got := mailer.sent(t)
	if len(got) != 1 {
		t.Fatalf("alerts = %+v, want exactly one", got)
	}
	if got[0].to != "rider@example.test" {
		t.Fatalf("alert went to %q", got[0].to)
	}
	// The rider reads "GitHub", not the id we store it under.
	if !strings.Contains(got[0].line, "GitHub") {
		t.Fatalf("alert %q does not name the provider as a rider reads it", got[0].line)
	}
}

// A refused removal is not a change, so it must not alarm — the rider who
// tried to remove their last credential got an error, not an event.
func TestRefusedDisconnectDoesNotAlert(t *testing.T) {
	s := testService(t)
	mailer := &fakeMailer{}
	s.SetMailer(mailer)
	user := testUser(t, s)
	if _, err := s.store.Pool.Exec(t.Context(),
		"update users set email = $2, email_verified_at = now() where id = $1",
		user.ID, "rider@example.test"); err != nil {
		t.Fatalf("verify address: %v", err)
	}
	cookie := signedIn(t, s, user)
	linkIdentity(t, s, user, "github", "only-credential")

	if w := disconnect(t, s, cookie, "github"); w.Code != http.StatusConflict {
		t.Fatalf("disconnect = %d, want 409: %s", w.Code, w.Body.String())
	}
	if got := mailer.sent(t); len(got) != 0 {
		t.Fatalf("a refused disconnect alerted %+v", got)
	}
}
