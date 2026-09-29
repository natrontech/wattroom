package notify

// Mail about the account itself: verifying an address, recovering the
// account, and the alerts a change to it sends. Split from notify.go (#3358).

import (
	"context"
	"fmt"
	"time"

	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// SendEmailVerification puts the confirm link in front of a rider (#781).
// Package auth owns the ceremony and calls this through its Mailer interface;
// notify owns the transport and the words.
func (s *Service) SendEmailVerification(ctx context.Context, to, link string) error {
	text := fmt.Sprintf(`Confirm this address so WattRoom can get you back into your
account if you ever lose the way you sign in:

%s

The link works once and expires in a day. If you did not add this address to
a WattRoom account, ignore this — nothing happens until someone follows it.`, link)
	// No Lead: nothing in this mail is live data, so nothing in it glows.
	return s.send(ctx, mail{
		From: s.alertFrom,
		To:   to, Subject: "Confirm your WattRoom email address",
		Heading: "Confirm your email address",
		Body: []string{
			"Confirm this address so WattRoom can get you back into your account if you ever lose the way you sign in.",
			"The link works once and expires in a day. If you did not add this address to a WattRoom account, ignore this — nothing happens until someone follows it.",
		},
		Action: "Confirm this address", URL: link,
		Text: text,
	})
}

// SendAccountRecovery puts the way back in front of a rider who has lost
// every credential (#1822, ADR-0051). The second link mail beside the
// confirmation above, and deliberately not the one-line alarm template: this
// one is the thing being asked for rather than a report of something that
// already happened, and the words have to be plain enough that a rider who
// asked for it recognises it and a rider who did not knows to ignore it.
//
// From the alarm's sender, not the bulk one: it is on the account's critical
// path, and a filter on the ride mail must not be what stops a lockout from
// clearing.
func (s *Service) SendAccountRecovery(ctx context.Context, to, link string) error {
	text := fmt.Sprintf(`Use this link to sign in to your WattRoom account:

%s

It works once and expires in a day. Signing in this way signs your account out
everywhere else, so add a passkey or connect a sign-in provider afterwards.

If you did not ask to get back into a WattRoom account, ignore this — nothing
happens until someone follows the link.`, link)
	// No Lead: nothing in this mail is live data, so nothing in it glows.
	return s.send(ctx, mail{
		From: s.alertFrom,
		To:   to, Subject: "Get back into your WattRoom account",
		Heading: "Sign in with this link",
		Body: []string{
			"Use this link to sign in to your WattRoom account.",
			"It works once and expires in a day. Signing in this way signs your account out everywhere else, so add a passkey or connect a sign-in provider afterwards.",
			"If you did not ask to get back into a WattRoom account, ignore this — nothing happens until someone follows the link.",
		},
		Action: "Sign in", URL: link,
		Text: text,
	})
}

// AccountAlert mails a rider that a way into their account changed (#840,
// ADR-0030). One template and one variable line across every trigger — a
// passkey, a provider, the recovery address — because the moment there are two
// security templates there are ten.
//
// Transactional: no unsubscribe header and no setting, since an alarm with an
// off switch is a decoration. Silent when the account holds no verified
// address; an unverified one is someone's typo until proven otherwise, and
// account activity is not something to narrate to it.
//
// The user passed in is whichever row holds the address that should hear about
// this — for a replaced address that is the row as it was *before* the
// replacement, which is the whole point of the alert.
func (s *Service) AccountAlert(user db.User, heading, line string) {
	s.alert(user, heading, line, "Check your account", s.baseURL+"/settings/profile")
}

// AccountDeleted is the receipt for a purge. Same template, but nothing to
// check afterwards and nothing to undo, so it carries no button — the one
// alert whose subject is not something the rider might want to reverse.
func (s *Service) AccountDeleted(user db.User) {
	s.alert(user, "Your WattRoom account was deleted",
		"Your account is gone, and so is every ride, crew membership and message that belonged to it. "+
			"Nothing was kept and there is nothing to undo.", "", "")
}

func (s *Service) alert(user db.User, heading, line, action, url string) {
	// The alarm's button goes to /settings/profile, behind the sign-in a
	// rider reading a hostile alarm may no longer have (#1822): an alert
	// that only links there tells someone locked out what happened and
	// nothing they can do about it. The way back in rides along with every
	// alarm that has a button; the purge receipt, which has none, has no
	// account left to recover.
	recoverURL := ""
	if action != "" {
		recoverURL = s.baseURL + "/login/recover"
	}
	m, ok := alertMail(user, heading, line, action, url, recoverURL)
	if !ok {
		return
	}
	m.From = s.alertFrom
	// Guarded and detached like the session mails: a mail provider must never
	// be on the path of an account action, and must never fail one.
	safego.Go(s.log, "account alert", func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if err := s.send(ctx, m); err != nil {
			// The address, never the account: this log line is about mail.
			s.log.Warn("account alert failed", "err", err)
		}
	})
}

// alertMail builds the alert, or reports that there is nobody to send it to.
// Separate from the sending so the rule that decides who hears about an
// account event is a plain function a test can ask directly.
func alertMail(user db.User, heading, line, action, url, recoverURL string) (mail, bool) {
	if user.Email == nil || !user.EmailVerifiedAt.Valid {
		return mail{}, false
	}
	body := []string{line}
	text := line
	if action != "" {
		body = append(body,
			"If that was you, there is nothing to do. If it was not, open your settings and check what your account signs in with.")
		text += "\n\nIf that was you, there is nothing to do. If it was not, check what your\naccount signs in with: " + url
		if recoverURL != "" {
			body = append(body,
				"Cannot sign in at all any more? Get back into the account with this address: "+recoverURL)
			text += "\n\nCannot sign in at all any more? Get back into the account with this\naddress: " + recoverURL
		}
	}
	return mail{
		To: *user.Email, Subject: heading, Heading: heading, Body: body,
		Action: action, URL: url, Text: text,
	}, true
}
