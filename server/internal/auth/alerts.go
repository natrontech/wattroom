package auth

// The security alarm (#840, ADR-0030). ADR-0029 made an account a set of
// credentials with a verified address as the way back in when all of them are
// gone; until this existed, nothing watched either half. A stolen session
// could register a permanent passkey without a sound, and confirming a
// replacement address told nobody at the address being replaced.
//
// Every trigger goes through one line here so the set stays enumerable: what
// WattRoom mails a rider about their own account is this file's call sites and
// nothing else.

import (
	"strings"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// alert mails the rider that a way into their account changed. Nil-safe, so a
// server with no mail capability simply does not alarm and the call sites stay
// one line; notify decides whether the address is one it may write to.
func (s *Service) alert(user db.User, heading, line string) {
	if s.mailer == nil {
		return
	}
	s.mailer.AccountAlert(user, heading, line)
}

// TokenMinted is the alarm for a new personal token (#2811). A token outlives
// the session that minted it — recovery revokes it, signing out does not — so
// it is a way into the rider's rides that a borrowed session can leave behind.
// The rider-typed name stays out of the mail: whoever minted it chose it.
func (s *Service) TokenMinted(user db.User) {
	s.alert(user, "A personal token was created",
		"A personal token was created for your WattRoom account. It reads your rides and progression until it is revoked on Settings › Data.")
}

// providerLabel is a provider id as a rider reads it. Only the odd
// capitalisation is worth saying; the rest is the id with a capital.
func providerLabel(id string) string {
	if id == "github" {
		return "GitHub"
	}
	if id == "" {
		return id
	}
	return strings.ToUpper(id[:1]) + id[1:]
}
