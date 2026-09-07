// Package secrets seals credentials that have to be stored and used again
// later, rather than merely checked — the Strava refresh token is the only one
// (#697). Session tokens are hashed instead, because nothing ever needs them
// back.
//
// What this protects against, precisely: a database dump that escapes the host
// without the app's environment. ADR-0019 has the deploy timer run pg_dump
// before every rollout, so those exist routinely on disk and in whatever backs
// them up. It protects against nothing else — under ADR-0002 the app and
// Postgres share one VM, so an attacker with code execution there has the
// environment and therefore the key. Encrypting the dumps themselves is the
// other half and lives in the operator's infrastructure repo.
package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"os"
)

// KeyEnv holds 32 random bytes, base64. Generate one with:
//
//	head -c 32 /dev/urandom | base64
const KeyEnv = "WATTROOM_TOKEN_KEY"

// Cipher seals and opens stored credentials. A nil Cipher is the unconfigured
// case and stores in the clear, which is what every deployment did before this
// existed — see FromEnv for why that is a warning rather than a refusal.
type Cipher struct{ aead cipher.AEAD }

// FromEnv reads KeyEnv.
//
// Absent: no cipher, a warning, and credentials keep being stored in the clear.
// This has to stay possible or the release that introduces the key cannot be
// deployed before the key is provisioned, and every dev box would need one to
// run a feature it does not exercise.
//
// Present but unusable: an error, and the caller should refuse to start. An
// operator who set the variable believes credentials are encrypted, and a
// server that boots anyway makes that belief false and silent. Failing loudly
// is also the safe direction under ADR-0019 — the health gate catches it and
// the previous image is rolled back, which is the designed response to a bad
// deploy.
func FromEnv(log *slog.Logger) (*Cipher, error) {
	raw := os.Getenv(KeyEnv)
	if raw == "" {
		log.Warn(KeyEnv + " is unset — stored third-party credentials are in the clear (#697)")
		return nil, nil
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("%s is not base64: %w", KeyEnv, err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("%s decodes to %d bytes, want 32 (AES-256)", KeyEnv, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", KeyEnv, err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", KeyEnv, err)
	}
	return &Cipher{aead: aead}, nil
}

// Enabled reports whether anything is actually encrypted. Nil-safe, so callers
// can hold a *Cipher that may be unconfigured without guarding every use.
func (c *Cipher) Enabled() bool { return c != nil && c.aead != nil }

// Seal returns nonce||ciphertext. A fresh nonce per call is the whole safety
// of GCM: reusing one with the same key reveals the plaintexts.
func (c *Cipher) Seal(plain string) ([]byte, error) {
	if !c.Enabled() {
		return nil, errors.New("secrets: no key configured")
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("secrets: nonce: %w", err)
	}
	return c.aead.Seal(nonce, nonce, []byte(plain), nil), nil
}

// Open reverses Seal. A failure here is a wrong key or a tampered row, never
// something to paper over with an empty string — the caller must be able to
// tell "no credential stored" from "cannot read the credential".
func (c *Cipher) Open(sealed []byte) (string, error) {
	if !c.Enabled() {
		return "", errors.New("secrets: no key configured")
	}
	if len(sealed) < c.aead.NonceSize() {
		return "", errors.New("secrets: sealed value is too short")
	}
	nonce, body := sealed[:c.aead.NonceSize()], sealed[c.aead.NonceSize():]
	plain, err := c.aead.Open(nil, nonce, body, nil)
	if err != nil {
		return "", fmt.Errorf("secrets: open: %w", err)
	}
	return string(plain), nil
}

// Columns returns how a refresh token should be written to `identities`:
// sealed with the plaintext column cleared when a key is configured, and
// exactly what the code did before when it is not.
//
// The pair is here rather than at each call site because "how a stored
// credential is stored" is this package's question, and three writers were
// about to answer it three times.
func (c *Cipher) Columns(token string) (plain *string, sealed []byte, err error) {
	// Nothing to protect, and the column has always held "" rather than null
	// for a provider that returned no refresh token.
	if token == "" || !c.Enabled() {
		return &token, nil, nil
	}
	sealed, err = c.Seal(token)
	if err != nil {
		return nil, nil, err
	}
	return nil, sealed, nil
}
