package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// recoverable is an account with a confirmed address, which is the only kind
// recovery is about (#1822).
func recoverable(t *testing.T, s *Service, address string) (db.User, *fakeMailer) {
	t.Helper()
	user, mailer := verifiable(t, s, address)
	if w := confirm(t, s, mailer.token(t)); w.Code != http.StatusOK {
		t.Fatalf("confirm the address: %d %s", w.Code, w.Body.String())
	}
	confirmed, err := s.store.Queries.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("re-read user: %v", err)
	}
	return confirmed, mailer
}

// ask posts one recovery request the way the sign-in page does.
func ask(t *testing.T, s *Service, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost,
		"http://localhost:8080/api/auth/recover", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleRecover(w, req)
	return w
}

// waitRecovery waits for the next recovery mail past `have` and returns it.
// The send is detached from the request on purpose (recover.go), so a test
// waits for it rather than reading it straight after the call.
func (m *fakeMailer) waitRecovery(t *testing.T, have int) recovery {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		m.mu.Lock()
		n := len(m.recoveries)
		var got recovery
		if n > have {
			got = m.recoveries[have]
		}
		m.mu.Unlock()
		if n > have {
			return got
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("no recovery mail arrived (have %d)", have)
	return recovery{}
}

func (m *fakeMailer) recoveriesSent(t *testing.T) []recovery {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]recovery(nil), m.recoveries...)
}

// recoverToken pulls the token back out of the link, the only place it exists
// in the clear.
func recoverToken(t *testing.T, link string) string {
	t.Helper()
	_, token, ok := strings.Cut(link, "/api/auth/recover/finish?t=")
	if !ok {
		t.Fatalf("not a recovery link: %q", link)
	}
	return token
}

// spend follows the emailed link the way a rider does: the page's form posts
// back to the same URL. `carrying` is a session cookie the browser still
// holds, since a rider recovering is often one whose old cookie is sitting
// right there.
func spend(t *testing.T, s *Service, token string, carrying ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost,
		"http://localhost:8080/api/auth/recover/finish?t="+token, nil)
	for _, c := range carrying {
		req.AddCookie(c)
	}
	w := httptest.NewRecorder()
	s.handleRecoverFinish(w, req)
	return w
}

// The whole ceremony, and the lockout it exists to end (#1822): the attacker's
// session dies, the rider's is the only one left, and the address hears about
// it.
func TestRecoveryEndsEveryOtherSessionAndSignsTheRiderIn(t *testing.T) {
	s := testService(t)
	user, mailer := recoverable(t, s, "locked-out@example.test")
	stolen := signedIn(t, s, user)
	if _, ok := s.User(withCookie(t, stolen)); !ok {
		t.Fatal("the session under test does not resolve")
	}

	if w := ask(t, s, `{"email":"locked-out@example.test"}`); w.Code != http.StatusNoContent {
		t.Fatalf("ask for a link: %d %s", w.Code, w.Body.String())
	}
	mail := mailer.waitRecovery(t, 0)
	if mail.to != "locked-out@example.test" {
		t.Fatalf("link mailed to %q", mail.to)
	}

	// The GET is a confirm button and nothing else: a mail scanner that
	// prefetches the link must not be handed the session.
	form := httptest.NewRecorder()
	s.handleRecoverFinishForm(form, httptest.NewRequestWithContext(t.Context(), http.MethodGet,
		"http://localhost:8080"+strings.TrimPrefix(mail.link, "http://localhost:8080"), nil))
	if form.Code != http.StatusOK {
		t.Fatalf("the confirm page: %d", form.Code)
	}
	for _, c := range form.Result().Cookies() {
		if c.Name == sessionCookie && c.Value != "" {
			t.Fatal("a GET on the recovery link minted a session")
		}
	}

	w := spend(t, s, recoverToken(t, mail.link))
	if w.Code != http.StatusOK {
		t.Fatalf("spend the link: %d %s", w.Code, w.Body.String())
	}
	var minted *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == sessionCookie && c.Value != "" {
			minted = c
		}
	}
	if minted == nil {
		t.Fatal("recovery minted no session")
	}
	if got, ok := s.User(withCookie(t, minted)); !ok || got.ID != user.ID {
		t.Fatalf("the minted session does not resolve to the account (ok=%v)", ok)
	}
	if _, ok := s.User(withCookie(t, stolen)); ok {
		t.Fatal("the other session survived recovery — the lockout is still live")
	}
	// One session, the rider's.
	var sessions int
	if err := s.store.Pool.QueryRow(context.Background(),
		"select count(*) from sessions where user_id = $1", user.ID).Scan(&sessions); err != nil || sessions != 1 {
		t.Fatalf("sessions on the account: %d (err %v), want exactly the new one", sessions, err)
	}
	// ADR-0030's alarm: the address is told a session was minted from it.
	alerts := mailer.sent(t)
	if len(alerts) == 0 || !strings.Contains(alerts[len(alerts)-1].heading, "recovered") {
		t.Fatalf("no recovery alarm: %+v", alerts)
	}
}

// Recovery keeps no session at all — not even one this browser is already
// carrying (#1822). "Every session but the one asking" is the rule for a
// signed-in rider pressing the settings button; here the rider asking is
// signed out by definition, and a cookie that survived would be the one
// thing recovery was supposed to clear.
func TestRecoveryKeepsNoSessionTheBrowserAlreadyHeld(t *testing.T) {
	s := testService(t)
	user, mailer := recoverable(t, s, "stale-cookie@example.test")
	stale := signedIn(t, s, user)

	if w := ask(t, s, `{"email":"stale-cookie@example.test"}`); w.Code != http.StatusNoContent {
		t.Fatalf("ask: %d", w.Code)
	}
	w := spend(t, s, recoverToken(t, mailer.waitRecovery(t, 0).link), stale)
	if w.Code != http.StatusOK {
		t.Fatalf("spend the link: %d %s", w.Code, w.Body.String())
	}
	if _, ok := s.User(withCookie(t, stale)); ok {
		t.Fatal("the cookie this browser arrived with survived recovery")
	}
	var sessions int
	if err := s.store.Pool.QueryRow(context.Background(),
		"select count(*) from sessions where user_id = $1", user.ID).Scan(&sessions); err != nil || sessions != 1 {
		t.Fatalf("sessions on the account: %d (err %v), want only the one just minted", sessions, err)
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == sessionCookie && c.Value != "" {
			if _, ok := s.User(withCookie(t, c)); !ok {
				t.Fatal("the session recovery minted does not resolve")
			}
			return
		}
	}
	t.Fatal("recovery minted no session")
}

// withCookie is a request carrying one session cookie, for asking whether it
// still resolves.
func withCookie(t *testing.T, c *http.Cookie) *http.Request {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/me", nil)
	req.AddCookie(c)
	return req
}

// A link is single use and time-bounded, and a stale one says only that:
// expired, spent, or never ours are one answer (#1822).
func TestRecoveryLinkIsSingleUseAndBounded(t *testing.T) {
	s := testService(t)
	user, mailer := recoverable(t, s, "single-use@example.test")

	if w := ask(t, s, `{"email":"single-use@example.test"}`); w.Code != http.StatusNoContent {
		t.Fatalf("ask: %d", w.Code)
	}
	token := recoverToken(t, mailer.waitRecovery(t, 0).link)
	if w := spend(t, s, token); w.Code != http.StatusOK {
		t.Fatalf("first use: %d %s", w.Code, w.Body.String())
	}
	replay := spend(t, s, token)
	if replay.Code != http.StatusNotFound {
		t.Fatalf("replayed link: %d, want 404", replay.Code)
	}
	for _, c := range replay.Result().Cookies() {
		if c.Name == sessionCookie && c.Value != "" {
			t.Fatal("a replayed link minted a second session")
		}
	}

	// An expired token is the same 404. Written straight in, since waiting a
	// day is not a test.
	stale := randomToken()
	if err := s.store.Queries.StartAccountRecovery(t.Context(), db.StartAccountRecoveryParams{
		ID: user.ID, RecoverHash: hash(stale),
		RecoverExpires: pgtype.Timestamptz{Time: time.Now().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatalf("store an expired token: %v", err)
	}
	if w := spend(t, s, stale); w.Code != http.StatusNotFound {
		t.Fatalf("expired link: %d, want 404", w.Code)
	}
	if w := spend(t, s, randomToken()); w.Code != http.StatusNotFound {
		t.Fatalf("a token that was never ours: %d, want 404", w.Code)
	}
	// And an incomplete link is a 400 rather than a lookup.
	blank := httptest.NewRecorder()
	s.handleRecoverFinish(blank, httptest.NewRequestWithContext(t.Context(), http.MethodPost,
		"http://localhost:8080/api/auth/recover/finish", nil))
	if blank.Code != http.StatusBadRequest {
		t.Fatalf("a link with no token: %d, want 400", blank.Code)
	}
}

// The answer must not say whether the address belongs to anyone — that is the
// enumeration surface ADR-0029 declined, and the reason this endpoint answers
// 204 with no body at all.
func TestRecoveryAnswersTheSameForAStranger(t *testing.T) {
	s := testService(t)
	_, mailer := recoverable(t, s, "known@example.test")

	unknown := ask(t, s, `{"email":"nobody@example.test"}`)
	if unknown.Code != http.StatusNoContent || unknown.Body.Len() != 0 {
		t.Fatalf("unknown address: %d %q, want 204 and no body", unknown.Code, unknown.Body.String())
	}
	known := ask(t, s, `{"email":"known@example.test"}`)
	if known.Code != unknown.Code || known.Body.String() != unknown.Body.String() {
		t.Fatalf("known %d %q vs unknown %d %q — the answers differ",
			known.Code, known.Body.String(), unknown.Code, unknown.Body.String())
	}
	// The known address was asked for second, so its mail arriving is also
	// the evidence the first request's goroutine has run its course.
	if got := mailer.waitRecovery(t, 0).to; got != "known@example.test" {
		t.Fatalf("mail went to %q", got)
	}
	for _, sent := range mailer.recoveriesSent(t) {
		if sent.to != "known@example.test" {
			t.Fatalf("mail left for an address no account holds: %+v", sent)
		}
	}
	if sent := mailer.recoveriesSent(t); len(sent) != 1 {
		t.Fatalf("%d recovery mails, want only the confirmed address's: %+v", len(sent), sent)
	}

	// An address nobody confirmed recovers nothing (ADR-0030). The rows that
	// predate #781 are exactly this shape — `email` hand-typed for session
	// mail, `email_verified_at` null — so this is a real state, not a
	// contrived one.
	legacy := testUser(t, s)
	if _, err := s.store.Pool.Exec(context.Background(),
		"update users set email = $2 where id = $1", legacy.ID, "legacy@example.test"); err != nil {
		t.Fatalf("write an unverified address: %v", err)
	}
	if w := ask(t, s, `{"email":"legacy@example.test"}`); w.Code != http.StatusNoContent {
		t.Fatalf("unverified address: %d", w.Code)
	}
	// Asked for last, so its arrival is again the evidence that the request
	// before it has finished whatever it was going to do.
	if w := ask(t, s, `{"email":"known@example.test"}`); w.Code != http.StatusNoContent {
		t.Fatalf("second ask for the confirmed address: %d", w.Code)
	}
	mailer.waitRecovery(t, 1)
	for _, got := range mailer.recoveriesSent(t) {
		if got.to != "known@example.test" {
			t.Fatalf("recovery mail for an address nobody confirmed: %+v", got)
		}
	}
	// And no token was minted on that account either — the row is what a
	// mail that never sent would still have left behind.
	row, err := s.store.Queries.GetUser(t.Context(), legacy.ID)
	if err != nil {
		t.Fatalf("read the unverified account: %v", err)
	}
	if row.RecoverHash != nil || row.RecoverExpires.Valid {
		t.Fatal("an unverified address got a recovery token")
	}
}

// Validation is at the boundary, and the field says which input to fix.
func TestRecoveryValidatesTheAddress(t *testing.T) {
	s := testService(t)
	recoverable(t, s, "valid@example.test")

	for _, tc := range []struct {
		name, body, code string
		status           int
	}{
		{"empty", `{"email":""}`, "validation_error", http.StatusBadRequest},
		{"not an address", `{"email":"not-an-address"}`, "validation_error", http.StatusBadRequest},
		{"a display-name form", `{"email":"Rider <r@example.test>"}`, "validation_error", http.StatusBadRequest},
		{"over 254 characters", `{"email":"` + strings.Repeat("a", 250) + `@example.test"}`, "validation_error", http.StatusBadRequest},
		{"not an object", `[]`, "invalid_request", http.StatusBadRequest},
		{"a field nobody declared", `{"email":"valid@example.test","admin":true}`, "invalid_request", http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := ask(t, s, tc.body)
			if w.Code != tc.status || !strings.Contains(w.Body.String(), `"`+tc.code+`"`) {
				t.Fatalf("%s: %d %s, want %d %s", tc.name, w.Code, w.Body.String(), tc.status, tc.code)
			}
			if !strings.Contains(w.Body.String(), `"message"`) {
				t.Fatalf("%s: no message to act on: %s", tc.name, w.Body.String())
			}
		})
	}

	// A form encoding is the login-CSRF shape #1823 closed: refused before
	// anything is spent, on the one door that has no session to check.
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost,
		"http://localhost:8080/api/auth/recover",
		strings.NewReader(`{"email":"valid@example.test"}`))
	req.Header.Set("Content-Type", "text/plain")
	w := httptest.NewRecorder()
	s.handleRecover(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("a form-encoded body: %d, want 400", w.Code)
	}
}

// Two ceilings, both before the database is asked anything (#1605, #1606):
// one on the caller, one on the address they ask about.
func TestRecoveryRefusesPastItsCeilings(t *testing.T) {
	s := testService(t)
	recoverable(t, s, "flooded@example.test")

	for i := 0; i < recoverMailsPerWindow; i++ {
		if w := ask(t, s, `{"email":"flooded@example.test"}`); w.Code != http.StatusNoContent {
			t.Fatalf("ask %d: %d %s", i, w.Code, w.Body.String())
		}
	}
	over := ask(t, s, `{"email":"flooded@example.test"}`)
	if over.Code != http.StatusTooManyRequests || !strings.Contains(over.Body.String(), `"rate_limited"`) {
		t.Fatalf("past the per-address ceiling: %d %s, want 429 rate_limited", over.Code, over.Body.String())
	}
	// Case does not buy a fresh budget.
	if w := ask(t, s, `{"email":"FLOODED@example.test"}`); w.Code != http.StatusTooManyRequests {
		t.Fatalf("the same address in capitals: %d, want 429", w.Code)
	}

	// And the caller's own door, counted per client address whatever they
	// type into the field: the asks above have already spent some of it, so
	// this walks fresh addresses until it shuts.
	shut := false
	for i := 0; i < recoverAsksPerWindow+2; i++ {
		w := ask(t, s, `{"email":"someone`+string(rune('a'+i))+`@example.test"}`)
		if w.Code == http.StatusTooManyRequests {
			if !strings.Contains(w.Body.String(), `"rate_limited"`) {
				t.Fatalf("the door refused without rate_limited: %s", w.Body.String())
			}
			shut = true
			break
		}
	}
	if !shut {
		t.Fatalf("the per-caller door never refused inside %d asks", recoverAsksPerWindow+2)
	}
}

// No mailer, no recovery — and it says so rather than promising a link
// nothing can send (capability gating, .claude/rules/ux.md).
func TestRecoveryWithoutAMailerSaysSo(t *testing.T) {
	s := testService(t)
	w := ask(t, s, `{"email":"rider@example.test"}`)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "cannot send email") {
		t.Fatalf("with no mailer: %d %s, want 400 saying why", w.Code, w.Body.String())
	}
}

// A live recovery link belongs to the address it was mailed to. Moving the
// address or removing it takes the link with it (#1822) — otherwise the old
// inbox keeps a way into the account long after it stopped being the
// account's.
func TestRecoveryTokenDiesWithTheAddress(t *testing.T) {
	s := testService(t)

	t.Run("a replaced address", func(t *testing.T) {
		user, mailer := recoverable(t, s, "old@example.test")
		if w := ask(t, s, `{"email":"old@example.test"}`); w.Code != http.StatusNoContent {
			t.Fatalf("ask: %d", w.Code)
		}
		token := recoverToken(t, mailer.waitRecovery(t, 0).link)
		// The rider moves to a new address and confirms it.
		fresh, err := s.store.Queries.GetUser(t.Context(), user.ID)
		if err != nil {
			t.Fatalf("re-read user: %v", err)
		}
		if _, err := s.startEmailVerification(t.Context(), fresh, "new@example.test"); err != nil {
			t.Fatalf("start the second verification: %v", err)
		}
		if w := confirm(t, s, mailer.token(t)); w.Code != http.StatusOK {
			t.Fatalf("confirm the new address: %d", w.Code)
		}
		if w := spend(t, s, token); w.Code != http.StatusNotFound {
			t.Fatalf("the old address's link: %d, want 404", w.Code)
		}
	})

	t.Run("a removed address", func(t *testing.T) {
		user, mailer := recoverable(t, s, "leaving@example.test")
		if w := ask(t, s, `{"email":"leaving@example.test"}`); w.Code != http.StatusNoContent {
			t.Fatalf("ask: %d", w.Code)
		}
		token := recoverToken(t, mailer.waitRecovery(t, 0).link)
		if _, err := s.store.Queries.ClearUserEmail(t.Context(), user.ID); err != nil {
			t.Fatalf("clear the address: %v", err)
		}
		if w := spend(t, s, token); w.Code != http.StatusNotFound {
			t.Fatalf("a removed address's link: %d, want 404", w.Code)
		}
	})
}

// A mail the transport refused was still charged for; the refund is what
// keeps a bounced attempt from eating the rider's confirmation budget
// (#1643).
func TestRecoveryRefundsAMailThatNeverLeft(t *testing.T) {
	s := testService(t)
	user, mailer := recoverable(t, s, "bounced@example.test")
	mailer.mu.Lock()
	mailer.recoverErr = errors.New("resend is down")
	mailer.mu.Unlock()

	if w := ask(t, s, `{"email":"bounced@example.test"}`); w.Code != http.StatusNoContent {
		t.Fatalf("ask: %d", w.Code)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		mailer.mu.Lock()
		tried := mailer.recoverCalls
		mailer.mu.Unlock()
		if tried > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the mail was never attempted")
		}
		time.Sleep(2 * time.Millisecond)
	}
	// The account's hourly mail budget is whole: one confirmation mail was
	// spent making the address, and the failed recovery gave its spend back.
	for i := 0; i < verifyMailsPerWindow-1; i++ {
		if !s.verifyMail.Spend(user.ID) {
			t.Fatalf("the account's mail budget lost a spend at %d", i)
		}
	}
}
