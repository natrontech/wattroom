package auth

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

type fakeMailer struct {
	mu     sync.Mutex
	to     string
	link   string
	calls  int
	err    error
	alerts []alert
}

// alert is one AccountAlert the code under test would have sent (#840).
type alert struct {
	to      string
	heading string
	line    string
}

func (m *fakeMailer) SendEmailVerification(_ context.Context, to, link string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	m.to, m.link = to, link
	return m.err
}

func (m *fakeMailer) AccountAlert(user db.User, heading, line string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	// The verified-address rule lives in notify, and the fake keeps it so a
	// test cannot pass on an alert production would never send.
	if user.Email == nil || !user.EmailVerifiedAt.Valid {
		return
	}
	m.alerts = append(m.alerts, alert{to: *user.Email, heading: heading, line: line})
}

func (m *fakeMailer) sent(t *testing.T) []alert {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]alert(nil), m.alerts...)
}

// token pulls the raw token back out of the link the mail would have carried,
// which is the only place it ever exists in the clear.
func (m *fakeMailer) token(t *testing.T) string {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	_, tok, ok := strings.Cut(m.link, "?t=")
	if !ok {
		t.Fatalf("no token in link %q", m.link)
	}
	return tok
}

// verifiable puts a user one click away from a confirmed address.
func verifiable(t *testing.T, s *Service, address string) (db.User, *fakeMailer) {
	t.Helper()
	mailer := &fakeMailer{}
	s.SetMailer(mailer)
	user := testUser(t, s)
	if _, err := s.startEmailVerification(t.Context(), user, address); err != nil {
		t.Fatalf("start verification: %v", err)
	}
	return user, mailer
}

func confirm(t *testing.T, s *Service, token string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	s.handleVerifyEmail(w, httptest.NewRequestWithContext(
		t.Context(), http.MethodPost, "/api/auth/verify-email?t="+token, nil))
	return w
}

func TestVerifyEmailPromotesPending(t *testing.T) {
	s := testService(t)
	user, mailer := verifiable(t, s, "rider@example.test")

	if mailer.calls != 1 || mailer.to != "rider@example.test" {
		t.Fatalf("mail not sent to the pending address: %+v", mailer)
	}
	before, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("read user: %v", err)
	}
	if before.Email != nil || before.EmailVerifiedAt.Valid {
		t.Fatalf("address counted before confirmation: %+v", before)
	}

	if w := confirm(t, s, mailer.token(t)); w.Code != http.StatusOK {
		t.Fatalf("confirm = %d: %s", w.Code, w.Body.String())
	}

	after, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("re-read user: %v", err)
	}
	switch {
	case after.Email == nil || *after.Email != "rider@example.test":
		t.Fatalf("address did not move across: %+v", after)
	case !after.EmailVerifiedAt.Valid:
		t.Fatalf("address not marked verified: %+v", after)
	case after.EmailPending != nil || after.EmailVerifyHash != nil:
		t.Fatalf("confirmation left its token behind: %+v", after)
	}
}

// The link works once: the row that matches is the row that clears the token.
func TestVerifyEmailIsSingleUse(t *testing.T) {
	s := testService(t)
	_, mailer := verifiable(t, s, "once@example.test")
	token := mailer.token(t)

	if w := confirm(t, s, token); w.Code != http.StatusOK {
		t.Fatalf("first confirm = %d", w.Code)
	}
	if w := confirm(t, s, token); w.Code != http.StatusNotFound {
		t.Fatalf("replayed link = %d, want 404", w.Code)
	}
}

func TestVerifyEmailRejectsExpiredAndUnknown(t *testing.T) {
	s := testService(t)
	user, mailer := verifiable(t, s, "stale@example.test")

	// Reach past the TTL rather than waiting a day for it.
	if _, err := s.store.Pool.Exec(t.Context(),
		"update users set email_verify_expires = $2 where id = $1",
		user.ID, time.Now().Add(-time.Minute)); err != nil {
		t.Fatalf("age the token: %v", err)
	}
	if w := confirm(t, s, mailer.token(t)); w.Code != http.StatusNotFound {
		t.Fatalf("expired link = %d, want 404", w.Code)
	}
	if w := confirm(t, s, randomToken()); w.Code != http.StatusNotFound {
		t.Fatalf("unknown token = %d, want 404", w.Code)
	}

	w := httptest.NewRecorder()
	s.handleVerifyEmail(w, httptest.NewRequestWithContext(
		t.Context(), http.MethodPost, "/api/auth/verify-email", nil))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("missing token = %d, want 400", w.Code)
	}
}

// A mail scanner prefetching the link must not confirm on the rider's behalf —
// the GET renders a button and changes nothing (same hazard as unsubscribe).
func TestVerifyEmailFormDoesNotVerify(t *testing.T) {
	s := testService(t)
	user, mailer := verifiable(t, s, "scanner@example.test")

	w := httptest.NewRecorder()
	s.handleVerifyEmailForm(w, httptest.NewRequestWithContext(
		t.Context(), http.MethodGet, "/api/auth/verify-email?t="+mailer.token(t), nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "<form method=\"post\">") {
		t.Fatalf("form = %d: %s", w.Code, w.Body.String())
	}
	// In WattRoom's shell, not the browser's default serif (#832).
	if body := w.Body.String(); !strings.Contains(body, "<title>") || !strings.Contains(body, "<style>") {
		t.Fatalf("form page has no shell: %s", body)
	}

	after, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("read user: %v", err)
	}
	if after.EmailVerifiedAt.Valid {
		t.Fatal("a GET confirmed the address")
	}
}

// Two accounts cannot hold one verified address: merging on a shared address
// is the attack class ADR-0029 rules out.
func TestVerifyEmailRefusesAnAddressVerifiedElsewhere(t *testing.T) {
	s := testService(t)
	_, first := verifiable(t, s, "shared@example.test")
	if w := confirm(t, s, first.token(t)); w.Code != http.StatusOK {
		t.Fatalf("first confirm = %d", w.Code)
	}

	// The check at request time, which is what the profile shows.
	second := testUser(t, s)
	if _, err := s.startEmailVerification(t.Context(), second, "SHARED@example.test"); !errors.Is(err, errEmailTaken) {
		t.Fatalf("start = %v, want errEmailTaken", err)
	}

	// And the index behind it, for a link already in flight when the other
	// account confirmed.
	token := randomToken()
	if _, err := s.store.Queries.StartEmailVerification(t.Context(), db.StartEmailVerificationParams{
		ID: second.ID, EmailPending: strPtr("shared@example.test"),
		EmailVerifyHash:    hash(token),
		EmailVerifyExpires: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
	}); err != nil {
		t.Fatalf("plant a race: %v", err)
	}
	if w := confirm(t, s, token); w.Code != http.StatusConflict {
		t.Fatalf("racing confirm = %d, want 409", w.Code)
	}
}

// Capability gating: a server that cannot send must refuse the field rather
// than store an address nothing will ever confirm.
func TestUpdateMeEmailNeedsAMailer(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	rec := httptest.NewRecorder()
	if err := s.startSession(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil), user.ID); err != nil {
		t.Fatalf("start session: %v", err)
	}

	req := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, "/api/me",
		strings.NewReader(`{"displayName":"x","ftpWatts":250,"weightKg":80,"email":"a@example.test"}`))
	req.AddCookie(rec.Result().Cookies()[0])
	w := httptest.NewRecorder()
	s.handleUpdateMe(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("mailerless patch = %d, want 400: %s", w.Code, w.Body.String())
	}
}

// Every account created from here on is asked to confirm; the ones that
// predate the migration are only nudged (#781).
func TestNewAccountsRequireAnEmail(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	if !user.EmailRequired {
		t.Fatal("a new account did not carry the requirement")
	}
	if me := s.toMe(user); me.EmailVerified || !me.EmailRequired {
		t.Fatalf("me does not report the state honestly: %+v", me)
	}
}

// A profile save re-sends the whole form, so an unchanged pending address
// must not mail the rider again on every FTP tweak.
func TestStartEmailVerificationDoesNotResendImmediately(t *testing.T) {
	s := testService(t)
	user, mailer := verifiable(t, s, "quiet@example.test")

	again, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("read user: %v", err)
	}
	if _, err := s.startEmailVerification(t.Context(), again, "quiet@example.test"); err != nil {
		t.Fatalf("second start: %v", err)
	}
	if mailer.calls != 1 {
		t.Fatalf("sent %d mails for one address, want 1", mailer.calls)
	}

	// Past the cooldown, asking again is a real request.
	if _, err := s.store.Pool.Exec(t.Context(),
		"update users set email_verify_expires = $2 where id = $1",
		user.ID, time.Now().Add(emailVerifyTTL-emailResendAfter-time.Minute)); err != nil {
		t.Fatalf("age the token: %v", err)
	}
	aged, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("re-read user: %v", err)
	}
	if _, err := s.startEmailVerification(t.Context(), aged, "quiet@example.test"); err != nil {
		t.Fatalf("resend: %v", err)
	}
	if mailer.calls != 2 {
		t.Fatalf("resend after the cooldown sent %d mails, want 2", mailer.calls)
	}
}

func strPtr(s string) *string { return &s }

// A send that fails must leave the row as it found it (#824): with the fresh
// token in place, the retry inside the resend window was a silent no-op —
// 200, emailPending set, the gate saying "link sent" for a mail that never
// left. And a link already out for the previous address keeps working.
func TestFailedSendRestoresThePreviousVerification(t *testing.T) {
	s := testService(t)
	user, mailer := verifiable(t, s, "first@example.test")
	firstToken := mailer.token(t)

	mailer.mu.Lock()
	mailer.err = errors.New("resend is down")
	mailer.mu.Unlock()
	before, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("read user: %v", err)
	}
	if _, err := s.startEmailVerification(t.Context(), before, "second@example.test"); err == nil {
		t.Fatal("a failed send reported success")
	}
	after, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("re-read user: %v", err)
	}
	if after.EmailPending == nil || *after.EmailPending != "first@example.test" {
		t.Fatalf("pending after a failed send = %v, want the first address back", after.EmailPending)
	}
	if !bytes.Equal(after.EmailVerifyHash, before.EmailVerifyHash) {
		t.Fatal("the failed send replaced the token that was already in an inbox")
	}
	// The first link still confirms.
	if w := confirm(t, s, firstToken); w.Code != http.StatusOK {
		t.Fatalf("first link after a failed second send = %d: %s", w.Code, w.Body.String())
	}
	// And once the mailer is back, asking again is a real send, not a no-op.
	mailer.mu.Lock()
	mailer.err = nil
	mailer.mu.Unlock()
	again, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("read user: %v", err)
	}
	if _, err := s.startEmailVerification(t.Context(), again, "second@example.test"); err != nil {
		t.Fatalf("retry after the mailer recovered: %v", err)
	}
	if mailer.calls != 3 {
		t.Fatalf("mailer called %d times, want 3 (first, failed, retry)", mailer.calls)
	}
}
