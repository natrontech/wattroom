package auth

// Email verification (#781, ADR-0029). The address is the account's recovery
// attribute — the way back in when every provider and passkey is gone — and
// never its login identifier.
//
// One path writes it. PATCH /api/me only ever stores a pending address beside
// a hashed single-use token; handleVerifyEmail is the only thing that promotes
// pending into `email`. That covers "no address yet" and "changing a verified
// one" with the same code, and it is what keeps a verified address live while
// its replacement is still unconfirmed — a typo cannot orphan an account.

import (
	"context"
	"errors"
	"fmt"
	"html"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Long enough to survive a mail that lands overnight, short enough that a
// forwarded inbox does not carry a live credential for a week.
const emailVerifyTTL = 24 * time.Hour

// A profile save carries the email field on every submit, so an unchanged
// pending address must not mint a fresh link each time — that would mail a
// rider once per FTP tweak. Long enough to stop the accidental storm, short
// enough that a deliberate "send again" works.
const emailResendAfter = 2 * time.Minute

// Mailer is all auth wants from notify: put one link in front of a rider.
// notify owns the transport and the copy. A nil mailer means the whole flow is
// absent rather than broken — the profile hides the section and the handler
// refuses the field (capability gating, .claude/rules/ux.md).
type Mailer interface {
	SendEmailVerification(ctx context.Context, to, link string) error
	// AccountAlert is the security alarm (#840); alerts.go is the only caller.
	AccountAlert(user db.User, heading, line string)
}

// SetMailer wires the notify capability in after construction.
func (s *Service) SetMailer(m Mailer) { s.mailer = m }

// errEmailTaken: another account has already verified this address. Refusing
// is the point — merging two accounts on a shared address is the attack class
// ADR-0029 rules out.
var errEmailTaken = errors.New("email verified on another account")

// errTooManyVerifications: this account has spent its hourly mail budget
// (budget.go). Refusing costs a rider one wait and costs an abuser the whole
// point of the exercise.
var errTooManyVerifications = errors.New("verification mail budget spent")

// errMailSend is the transport refusing (#1643): the one failure the rider
// should hear as "the email could not be sent" rather than as a save error.
var errMailSend = errors.New("verification mail not sent")

// startEmailVerification stores the pending address with a hashed single-use
// token and mails the link out. The rider's current address is untouched until
// they follow it.
func (s *Service) startEmailVerification(ctx context.Context, user db.User, address string) (db.User, error) {
	// Same address, link still fresh: the rider is saving their profile, not
	// asking again. Silent success — nothing is wrong, and a second mail is
	// not what they meant.
	if user.EmailPending != nil && strings.EqualFold(*user.EmailPending, address) &&
		user.EmailVerifyExpires.Valid &&
		time.Until(user.EmailVerifyExpires.Time) > emailVerifyTTL-emailResendAfter {
		return user, nil
	}

	// The ceiling belongs here, past the early return above: that return is
	// the rider saving their profile again, and spending budget on a mail
	// nobody sends would punish them for it. Everything below this line puts
	// a message in somebody's inbox — or answers whether an address is
	// somebody's, which is worth exactly as much to a stranger (#1605): the
	// taken check used to sit above the budget, an existence oracle at
	// request rate for any signed-in account.
	if !s.verifyMail.Spend(user.ID) {
		return db.User{}, errTooManyVerifications
	}
	taken, err := s.store.Queries.EmailVerifiedElsewhere(ctx, db.EmailVerifiedElsewhereParams{
		Email: address, UserID: user.ID,
	})
	if err != nil {
		return db.User{}, err
	}
	if taken {
		return db.User{}, errEmailTaken
	}

	token := randomToken()
	updated, err := s.store.Queries.StartEmailVerification(ctx, db.StartEmailVerificationParams{
		ID:                 user.ID,
		EmailPending:       &address,
		EmailVerifyHash:    hash(token),
		EmailVerifyExpires: pgtype.Timestamptz{Time: time.Now().Add(emailVerifyTTL), Valid: true},
	})
	if err != nil {
		return db.User{}, err
	}
	link := s.baseURL + "/api/auth/verify-email?t=" + token
	if err := s.mailer.SendEmailVerification(ctx, address, link); err != nil {
		// Nothing went out, so nothing may look sent: with the fresh token
		// left in place the retry inside the resend window was a silent
		// no-op, and the gate said "link sent" for a mail that never left
		// (#824). Put back whatever was there — a link already in the inbox
		// for the previous address keeps working.
		if _, undo := s.store.Queries.StartEmailVerification(ctx, db.StartEmailVerificationParams{
			ID: user.ID, EmailPending: user.EmailPending,
			EmailVerifyHash: user.EmailVerifyHash, EmailVerifyExpires: user.EmailVerifyExpires,
		}); undo != nil {
			s.log.Error("undoing a failed verification start", "err", undo)
		}
		// Charged for a mail that never left (#1643).
		s.verifyMail.Refund(user.ID)
		return db.User{}, fmt.Errorf("%w: %w", errMailSend, err)
	}
	return updated, nil
}

// handleVerifyEmailForm answers the emailed link with a plain confirm page.
// The click arrives from a mail client, not the SPA, and a GET that verified
// on its own would let a scanner prefetching the link confirm an address the
// rider never opened — the same hazard the unsubscribe flow guards against
// (server/internal/notify/notify.go).
func (s *Service) handleVerifyEmailForm(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("t") == "" {
		s.verifyOutcome(w, http.StatusBadRequest, "That link is incomplete",
			"Use the link from the email, or ask for a new one in your WattRoom settings.")
		return
	}
	// No action attribute: the form posts back to this same URL, token and
	// all, so nothing request-derived is ever written into the HTML.
	httpx.WritePage(w, http.StatusOK, "Confirm your address", httpx.PageBody(
		"Confirm this address?",
		"It becomes the address on your WattRoom account — the way back in if every other sign-in is ever lost.",
		`<form method="post"><button>Confirm</button></form>`))
}

// verifyOutcome is the page a click lands on when it cannot confirm: the
// click came from a mail client, so the answer is a page, not JSON — and it
// offers the way to a fresh link.
func (s *Service) verifyOutcome(w http.ResponseWriter, status int, heading, line string) {
	httpx.WritePage(w, status, heading, httpx.PageBody(heading, line,
		httpx.PageLink(s.baseURL+"/settings/profile", "Back to WattRoom")))
}

func (s *Service) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("t")
	if token == "" {
		s.verifyOutcome(w, http.StatusBadRequest, "That link is incomplete",
			"Use the link from the email, or ask for a new one in your WattRoom settings.")
		return
	}

	// Whose link is this, and what address does the account hold right now?
	// Read it before the promotion: afterwards the old address is gone, and
	// the rider who most needs to hear that it moved is the one sitting at it.
	previous, previousErr := s.store.Queries.UserByEmailVerifyHash(r.Context(), hash(token))

	user, err := s.store.Queries.VerifyEmail(r.Context(), hash(token))
	switch {
	case err == nil:
	case errors.Is(err, pgx.ErrNoRows):
		// Expired, already used, or never ours — all the same answer, and
		// none of them says whether an account exists.
		s.verifyOutcome(w, http.StatusNotFound, "That link has expired or was already used",
			"Ask for a new one in your WattRoom settings.")
		return
	default:
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			s.verifyOutcome(w, http.StatusConflict, "That address is already confirmed elsewhere",
				"Another WattRoom account holds it. Sign in with that account, or use a different address.")
			return
		}
		s.log.Error("email verification failed", "err", err)
		s.verifyOutcome(w, http.StatusInternalServerError, "That did not work",
			"Confirming the address failed on our side. Try the link again.")
		return
	}

	s.log.Info("email verified", "user", user.ID)
	address := ""
	if user.Email != nil {
		address = *user.Email
	}
	// Silent unless the account already held a verified address — a first
	// confirmation replaces nothing, and there is nobody to tell.
	if previousErr == nil {
		s.alert(previous, "The recovery address on your account changed",
			"Your WattRoom account now uses "+address+" to get you back in if you ever lose the way you sign in. This address no longer does.")
	}
	httpx.WritePage(w, http.StatusOK, "Address confirmed",
		"<h1>Confirmed</h1><p><strong>"+html.EscapeString(address)+"</strong> is now the address on your WattRoom account.</p>"+
			httpx.PageLink(s.baseURL, "Back to WattRoom"))
}

// emailUpdate is the email half of PATCH /api/me, kept out of the profile
// handler because it is the only field whose write is a two-step ceremony.
// Returns the user as the response should carry it.
func (s *Service) emailUpdate(ctx context.Context, w http.ResponseWriter, user db.User, requested string) (db.User, bool) {
	address := strings.TrimSpace(requested)

	// Already confirmed, and unchanged: nothing to send, nothing to store.
	if user.EmailVerifiedAt.Valid && user.Email != nil && strings.EqualFold(*user.Email, address) {
		return user, true
	}
	if len(address) > 254 || !validEmail(address) {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"That does not look like an email address.", "email")
		return db.User{}, false
	}
	if s.mailer == nil {
		httpx.WriteFieldError(w, http.StatusBadRequest, "validation_error",
			"This server cannot send email, so an address cannot be confirmed here.", "email")
		return db.User{}, false
	}

	updated, err := s.startEmailVerification(ctx, user, address)
	switch {
	case err == nil:
		return updated, true
	case errors.Is(err, errEmailTaken):
		httpx.WriteFieldError(w, http.StatusConflict, "conflict",
			"Another WattRoom account has already confirmed that address. Sign in with that account, or use a different one.", "email")
	case errors.Is(err, errTooManyVerifications):
		httpx.WriteFieldError(w, http.StatusTooManyRequests, "rate_limited",
			"That is a lot of confirmation emails in one hour. Wait an hour, then try again.", "email")
	case errors.Is(err, errMailSend):
		s.log.Error("confirmation mail not sent", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The confirmation email could not be sent. Try again.")
	default:
		s.log.Error("starting email verification failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Your profile could not be saved. Try again.")
	}
	return db.User{}, false
}

// clearEmail drops the address and everything that vouched for it — after
// telling that address (#1638): removal is the replacement alarm of
// ADR-0030 with the confirmation step removed, and without it a stolen
// session could mute every later alarm and destroy recovery in one call.
func (s *Service) clearEmail(ctx context.Context, w http.ResponseWriter, user db.User) (db.User, bool) {
	s.alert(user, "The email address was removed from your account",
		"The recovery address on your WattRoom account was removed. Without one there is no way back into the account if every passkey and sign-in provider is lost, and no more alarms like this one.")
	updated, err := s.store.Queries.ClearUserEmail(ctx, user.ID)
	if err != nil {
		s.log.Error("clearing email failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Your profile could not be saved. Try again.")
		return db.User{}, false
	}
	return updated, true
}
