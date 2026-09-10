package auth

// Account recovery (#1822, ADR-0051): the way back in when every credential
// is gone. ADR-0029 called the verified address the account's recovery
// attribute and WATTROOM.md repeated it, but nothing recovered anything — a
// stolen session that registered its own passkey and then disconnected the
// rider's only provider left the rider outside their own account for good,
// with two alarm mails linking to a page behind the sign-in they had just
// lost.
//
// Two steps, the same ceremony as the confirmation next door in email.go: a
// hashed single-use token on its own pair of columns, mailed to the verified
// address, spent by a link that mints a session. The trade — whoever reads
// the mailbox can take the account — is accepted and written down in
// ADR-0051 rather than left to be inferred from this file.

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The mailed link runs on the confirmation link's clock: long enough to
// survive a mail that lands overnight, short enough that a forwarded inbox
// does not carry a live credential for a week. One constant for both, because
// the reasoning is the same one and two numbers would drift apart.
const recoverTTL = emailVerifyTTL

// handleRecover mails the way back in, and says the same thing whether or not
// the address belongs to an account.
//
// Nothing about the answer may depend on the account: not the status, not the
// body, and not how long it takes — which is why the whole of the work hangs
// off mailRecovery in a goroutine and this handler answers 204 before any of
// it has happened. "Type an address, learn whether it is a rider" is the
// enumeration surface ADR-0029 declined when it refused identifier-first
// sign-in, and it would be strange to build it here instead.
func (s *Service) handleRecover(w http.ResponseWriter, r *http.Request) {
	// This one mints nothing by itself, but it does cause mail: the CSRF
	// boundary every other mutating route reaches through RequireUser,
	// applied by hand because recovery is by definition signed out (#1828).
	if !s.SameOrigin(r) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Cross-origin request refused.")
		return
	}
	var body struct {
		Email string `json:"email"`
	}
	if err := httpx.DecodeStrict(r, &body); err != nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "invalid_request",
			"Send the email address confirmed on the account.", "email")
		return
	}
	address := strings.TrimSpace(body.Email)
	if len(address) > 254 || !validEmail(address) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That does not look like an email address.", "email")
		return
	}
	// Capability gating: where mail is unconfigured nobody has a confirmed
	// address, so recovery cannot work and says so instead of pretending a
	// link is on its way.
	if s.mailer == nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"This server cannot send email, so an account cannot be recovered here.", "email")
		return
	}

	// Both ceilings before the lookup (#1605, #1606) and both past the
	// validation above: a rider mistyping their own address must not spend
	// the door on the attempt that was never going to send anything, and a
	// malformed body costs a bounded JSON decode and nothing else.
	if s.throttle(w, r, s.recoverDoor) {
		return
	}
	// Spending the second on the address the caller typed rather than on the
	// account it may name is what lets it be charged at all before the
	// database is asked whether that account exists. Refusing here says
	// nothing either — the count is of what this caller asked for.
	//
	// It does let a stranger who knows a rider's address spend that
	// address's hourly link budget on their behalf, which delays a recovery
	// by up to an hour. ADR-0051 takes that over the alternative, which is
	// no ceiling on mail to an address a stranger types.
	if !s.recoverMail.Spend(strings.ToLower(address)) {
		httpx.WriteFieldError(w, http.StatusTooManyRequests, "rate_limited",
			"That is a lot of recovery emails for one address. Wait an hour, then try again.", "email")
		return
	}

	s.mailRecovery(address)
	// Deliberately contentless: a body is a place for the two cases to differ.
	w.WriteHeader(http.StatusNoContent)
}

// mailRecovery finds the account, mints the token and sends the link —
// detached from the request that asked for it. Two reasons, either sufficient:
// the answer above must not differ for a known and an unknown address, and a
// response that waits for the mail provider differs by a few hundred
// milliseconds, which is the same oracle the identical body just closed; and a
// mail provider must never sit on the path of an account action (notify.alert
// has this shape for that half).
//
// Every failure in here is logged and nothing else. There is nobody to tell:
// the request is already answered, and it was answered the same way for the
// address that has no account at all.
func (s *Service) mailRecovery(address string) {
	safego.Go(s.log, "account recovery mail", func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()

		user, err := s.store.Queries.UserByVerifiedEmail(ctx, address)
		switch {
		case err == nil:
		case errors.Is(err, pgx.ErrNoRows):
			// No account holds this address. Nothing to send, and nothing
			// said about it.
			return
		default:
			s.log.Error("recovery lookup failed", "err", err)
			return
		}
		// The query's predicate makes this unreachable; the guard is here
		// because the alternative to it is dereferencing nil in a detached
		// goroutine, and the row is one schema change away from allowing it.
		if user.Email == nil {
			return
		}

		// The account's own hourly mail ceiling, shared with the confirmation
		// ceremony (#827): recovery mail is mail this account causes. The
		// per-address ceiling in the handler is what stops a stranger
		// spending a rider's whole budget on their behalf — it refuses at
		// three, well under the ten this one holds, so asking for a link can
		// never be the reason a rider cannot confirm an address.
		if !s.verifyMail.Spend(user.ID) {
			s.log.Warn("recovery mail budget spent", "user", store.UUIDString(user.ID))
			return
		}

		token := randomToken()
		if err := s.store.Queries.StartAccountRecovery(ctx, db.StartAccountRecoveryParams{
			ID:             user.ID,
			RecoverHash:    hash(token),
			RecoverExpires: pgtype.Timestamptz{Time: time.Now().Add(recoverTTL), Valid: true},
		}); err != nil {
			s.log.Error("storing a recovery token failed", "err", err, "user", store.UUIDString(user.ID))
			s.verifyMail.Refund(user.ID)
			return
		}

		// To the stored address, not the typed one: the lookup is
		// case-insensitive and the mail goes where the account says.
		if err := s.mailer.SendAccountRecovery(ctx, *user.Email,
			s.baseURL+"/api/auth/recover/finish?t="+token); err != nil {
			// Charged for a mail that never left (#1643). The token stays
			// where it is: nobody holds it, it expires on its own, and
			// clearing it would revoke whatever a retry has since minted.
			s.verifyMail.Refund(user.ID)
			s.log.Warn("recovery mail not sent", "err", err)
		}
	})
}

// recoverOutcome is the page a recovery link lands on. The click comes from a
// mail client rather than the SPA, so the answer is a page like the
// confirmation ceremony's, and it offers the way to a fresh link.
func (s *Service) recoverOutcome(w http.ResponseWriter, status int, heading, line string) {
	httpx.WritePage(w, status, heading, httpx.PageBody(heading, line,
		httpx.PageLink(s.baseURL+"/login/recover", "Ask for a new link")))
}

// handleRecoverFinishForm answers the emailed link with a confirm button. A
// GET that signed a rider in on its own would hand the session to whichever
// mail scanner prefetched the link first — the same hazard the confirmation
// form and the unsubscribe form both guard against, and the worst of the
// three to lose.
func (s *Service) handleRecoverFinishForm(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("t") == "" {
		s.recoverOutcome(w, http.StatusBadRequest, "That link is incomplete",
			"Use the link from the email, or ask for a new one.")
		return
	}
	// No action attribute: the form posts back to this same URL, token and
	// all, so nothing request-derived is ever written into the HTML.
	httpx.WritePage(w, http.StatusOK, "Sign in", httpx.PageBody(
		"Sign in to your WattRoom account?",
		"This link works once. It signs the account out everywhere else, so you will be the only one in it.",
		`<form method="post"><button>Sign in</button></form>`))
}

// handleRecoverFinish spends the token: every session of the account ends, one
// new one begins, and the rider holding this link holds it.
func (s *Service) handleRecoverFinish(w http.ResponseWriter, r *http.Request) {
	if !s.SameOrigin(r) {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Cross-origin request refused.")
		return
	}
	token := r.URL.Query().Get("t")
	if token == "" {
		s.recoverOutcome(w, http.StatusBadRequest, "That link is incomplete",
			"Use the link from the email, or ask for a new one.")
		return
	}

	user, err := s.store.Queries.ConsumeAccountRecovery(r.Context(), hash(token))
	switch {
	case err == nil:
	case errors.Is(err, pgx.ErrNoRows):
		// Expired, already spent, or never ours — one answer for all three,
		// none of which says whether an account exists.
		s.recoverOutcome(w, http.StatusNotFound, "That link has expired or was already used",
			"Ask for a new one and open the newest email.")
		return
	default:
		s.log.Error("spending a recovery token failed", "err", err)
		s.recoverOutcome(w, http.StatusInternalServerError, "That did not work",
			"Signing you in failed on our side. Try the link again.")
		return
	}

	// Every session, then the new one — in that order (#1822). This request
	// carries no session of its own, so endOtherSessions would have nothing
	// to keep and would end the very session startSession is about to mint;
	// and a stale cookie in this browser must not be the one thing that
	// survives a recovery. Whoever else was in the account is out of it
	// before the rider is in.
	ended := s.endSessions(r.Context(), user.ID, nil)
	if err := s.startSession(w, r, user.ID); err != nil {
		s.log.Error("recovery session create failed", "err", err, "user", store.UUIDString(user.ID))
		s.recoverOutcome(w, http.StatusInternalServerError, "That did not work",
			"You were signed out everywhere, but the new session could not be saved. Ask for a new link.")
		return
	}
	s.log.Info("account recovered by email", "user", store.UUIDString(user.ID), "sessionsEnded", ended)
	s.alert(user, "Your account was recovered by email",
		"Someone used the recovery link sent to this address to sign in to your WattRoom account, and every other signed-in screen was signed out.")

	// The account may now hold no credential at all — recovery is for exactly
	// the rider whose last one is gone — so the one thing to do next is add
	// one, and the page says so rather than dropping them on the dashboard to
	// find out at the next sign-in.
	httpx.WritePage(w, http.StatusOK, "You are signed in", httpx.PageBody(
		"You are signed in",
		"Every other screen was signed out. Add a passkey or connect a sign-in provider now — that, not this email, is how you get in next time.",
		httpx.PageLink(s.baseURL+"/settings/profile", "Add a way to sign in")))
}
