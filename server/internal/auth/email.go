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
}

// SetMailer wires the notify capability in after construction.
func (s *Service) SetMailer(m Mailer) { s.mailer = m }

// errEmailTaken: another account has already verified this address. Refusing
// is the point — merging two accounts on a shared address is the attack class
// ADR-0029 rules out.
var errEmailTaken = errors.New("email verified on another account")

// startEmailVerification stores the pending address with a hashed single-use
// token and mails the link out. The rider's current address is untouched until
// they follow it.
func (s *Service) startEmailVerification(ctx context.Context, user db.User, address string) (db.User, error) {
	taken, err := s.store.Queries.EmailVerifiedElsewhere(ctx, db.EmailVerifiedElsewhereParams{
		Email: address, UserID: user.ID,
	})
	if err != nil {
		return db.User{}, err
	}
	if taken {
		return db.User{}, errEmailTaken
	}
	// Same address, link still fresh: the rider is saving their profile, not
	// asking again. Silent success — nothing is wrong, and a second mail is
	// not what they meant.
	if user.EmailPending != nil && strings.EqualFold(*user.EmailPending, address) &&
		user.EmailVerifyExpires.Valid &&
		time.Until(user.EmailVerifyExpires.Time) > emailVerifyTTL-emailResendAfter {
		return user, nil
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
		// The row stays: the rider can ask again from the profile, and a
		// pending address with a dead token is harmless.
		return db.User{}, err
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
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"That confirmation link is incomplete. Use the link from the email, or ask for a new one in your WattRoom profile.")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// No action attribute: the form posts back to this same URL, token and
	// all, so nothing request-derived is ever written into the HTML.
	_, _ = fmt.Fprint(w, `<form method="post">
<p>Confirm this address for your WattRoom account?</p><button>Confirm</button></form>`)
}

func (s *Service) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("t")
	if token == "" {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"That confirmation link is incomplete. Use the link from the email, or ask for a new one in your WattRoom profile.")
		return
	}

	user, err := s.store.Queries.VerifyEmail(r.Context(), hash(token))
	switch {
	case err == nil:
	case errors.Is(err, pgx.ErrNoRows):
		// Expired, already used, or never ours — all the same answer, and
		// none of them says whether an account exists.
		httpx.WriteError(w, http.StatusNotFound, "not_found",
			"That confirmation link has expired or was already used. Ask for a new one in your WattRoom profile.")
		return
	default:
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			httpx.WriteError(w, http.StatusConflict, "conflict",
				"Another WattRoom account has already confirmed that address. Sign in with that account, or use a different address.")
			return
		}
		s.log.Error("email verification failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Confirming the address did not work. Try the link again.")
		return
	}

	s.log.Info("email verified", "user", user.ID)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	address := ""
	if user.Email != nil {
		address = *user.Email
	}
	_, _ = fmt.Fprintf(w, `<p>Confirmed — %s is now the address on your WattRoom account.</p>
<p><a href="%s">Back to WattRoom</a></p>`, html.EscapeString(address), html.EscapeString(s.baseURL))
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
	default:
		s.log.Error("starting email verification failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The confirmation email could not be sent. Try again.")
	}
	return db.User{}, false
}

// clearEmail drops the address and everything that vouched for it.
func (s *Service) clearEmail(ctx context.Context, w http.ResponseWriter, user db.User) (db.User, bool) {
	updated, err := s.store.Queries.ClearUserEmail(ctx, user.ID)
	if err != nil {
		s.log.Error("clearing email failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Your profile could not be saved. Try again.")
		return db.User{}, false
	}
	return updated, true
}
