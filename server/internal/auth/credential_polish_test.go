package auth

import (
	"context"
	"slices"
	"strings"
	"testing"
)

// WATTROOM_SYNTHETIC_TOKEN mounts an unauthenticated-by-default door on a
// production server whose only protection is the value's secrecy (#153), and
// nothing checked its shape (#2258) — while both neighbouring credential
// variables are checked loudly at boot: the token key must decode to 32 bytes
// (ADR-0035) and the dev login refuses a public base URL (#1603), because "a
// warning in a log nobody reads is how an unauthenticated door reaches
// production".
func TestTheSyntheticDoorRefusesAWeakToken(t *testing.T) {
	for _, tc := range []struct {
		name, token string
		wantErr     bool
	}{
		{"unset is the door closed", "", false},
		{"a typo", "hunter2", true},
		{"just under the bar", strings.Repeat("a", minSyntheticToken-1), true},
		{"at the bar", strings.Repeat("a", minSyntheticToken), false},
		{"a real one", "2f9c1d4e8b7a6350fe21c4d9ab8370e5", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("WATTROOM_SYNTHETIC_TOKEN", tc.token)
			err := SyntheticTokenTooWeak()
			if (err != nil) != tc.wantErr {
				t.Fatalf("SyntheticTokenTooWeak() = %v, want error: %v", err, tc.wantErr)
			}
			if err != nil && !strings.Contains(err.Error(), "WATTROOM_SYNTHETIC_TOKEN") {
				t.Errorf("the refusal does not name the variable: %v", err)
			}
		})
	}
}

// Every entry in WATTROOM_EXTRA_ORIGINS could complete a WebAuthn ceremony
// for this relying party, and they were appended unchecked with a comment for
// a defence — "is unset in production where there is only one" (#2258). The
// package already owns localOrigin(), written for exactly this class of
// dev-only hatch.
func TestExtraPasskeyOriginsAreLocalOnly(t *testing.T) {
	t.Setenv("WATTROOM_EXTRA_ORIGINS",
		"http://localhost:5507, https://evil.example, http://192.168.1.9:5173, https://wattroom.ch.attacker.test")
	wa, err := newWebAuthn("http://localhost:8107")
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	for _, want := range []string{"http://localhost:8107", "http://localhost:5507", "http://192.168.1.9:5173"} {
		if !slices.Contains(wa.Config.RPOrigins, want) {
			t.Errorf("a local origin was dropped: %q missing from %v", want, wa.Config.RPOrigins)
		}
	}
	for _, never := range []string{"https://evil.example", "https://wattroom.ch.attacker.test"} {
		if slices.Contains(wa.Config.RPOrigins, never) {
			t.Errorf("a public origin can complete a ceremony for this relying party: %q", never)
		}
	}
}

// /api/me ran four extra reads and swallowed every error: no log, no field,
// no status change (#2258). Providers drives the profile's connect rows
// (#719), so a transient failure answered 200 with the account rendered as
// holding NO sign-in provider — a credential decision made on a lie. The
// other three are decorations and stay best effort.
func TestTheAccountRecordFailsRatherThanLoseItsProviders(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)

	if _, err := s.fullMe(t.Context(), user); err != nil {
		t.Fatalf("a healthy read failed: %v", err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := s.fullMe(ctx, user); err == nil {
		t.Error("a database that did not answer still produced an account record")
	}
}
