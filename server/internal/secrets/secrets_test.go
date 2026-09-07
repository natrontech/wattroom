package secrets

import (
	"encoding/base64"
	"io"
	"log/slog"
	"strings"
	"testing"
)

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func key(t *testing.T, n int) string {
	t.Helper()
	return base64.StdEncoding.EncodeToString(make([]byte, n))
}

func configured(t *testing.T) *Cipher {
	t.Helper()
	t.Setenv(KeyEnv, key(t, 32))
	c, err := FromEnv(quiet())
	if err != nil {
		t.Fatalf("FromEnv: %v", err)
	}
	if !c.Enabled() {
		t.Fatal("cipher is not enabled with a good key")
	}
	return c
}

func TestFromEnv(t *testing.T) {
	cases := []struct {
		name    string
		value   string
		wantErr string
		enabled bool
	}{
		// Unset has to keep working: the release that introduces the key ships
		// before the key is provisioned, and dev boxes never have one.
		{name: "unset"},
		{name: "good key", value: key(t, 32), enabled: true},
		{name: "not base64", value: "nonsense!!", wantErr: "not base64"},
		{name: "too short", value: key(t, 16), wantErr: "want 32"},
		{name: "too long", value: key(t, 64), wantErr: "want 32"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(KeyEnv, tc.value)
			c, err := FromEnv(quiet())
			switch {
			case tc.wantErr != "":
				// A key that is set but unusable must fail the caller, never
				// quietly store in the clear under an operator who believes
				// otherwise.
				if err == nil {
					t.Fatalf("want an error containing %q, got none", tc.wantErr)
				}
				if !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("error %q does not mention %q", err, tc.wantErr)
				}
			case err != nil:
				t.Fatalf("unexpected error: %v", err)
			case c.Enabled() != tc.enabled:
				t.Fatalf("Enabled() = %v, want %v", c.Enabled(), tc.enabled)
			}
		})
	}
}

func TestSealOpenRoundTrip(t *testing.T) {
	c := configured(t)
	const token = "e5b1c0f4refresh"
	sealed, err := c.Seal(token)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if strings.Contains(string(sealed), token) {
		t.Fatal("the token is readable in the sealed bytes")
	}
	got, err := c.Open(sealed)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if got != token {
		t.Fatalf("Open = %q, want %q", got, token)
	}
}

// A fresh nonce per call is the whole safety of GCM; sealing twice must not
// produce the same bytes, or the key is being reused against itself.
func TestSealIsNotDeterministic(t *testing.T) {
	c := configured(t)
	a, err := c.Seal("same")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	b, err := c.Seal("same")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if string(a) == string(b) {
		t.Fatal("two seals of one plaintext are identical — the nonce is not fresh")
	}
}

func TestOpenRefusesTamperedAndForeign(t *testing.T) {
	c := configured(t)
	sealed, err := c.Seal("token")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	bad := make([]byte, len(sealed))
	copy(bad, sealed)
	bad[len(bad)-1] ^= 0xff
	if _, err := c.Open(bad); err == nil {
		t.Fatal("a tampered ciphertext opened")
	}

	if _, err := c.Open(sealed[:c.aead.NonceSize()-1]); err == nil {
		t.Fatal("a value shorter than the nonce opened")
	}

	// Another deployment's key must not read this row — the point of the
	// exercise is that the dump alone is not enough.
	t.Setenv(KeyEnv, base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32))))
	other, err := FromEnv(quiet())
	if err != nil {
		t.Fatalf("FromEnv: %v", err)
	}
	if _, err := other.Open(sealed); err == nil {
		t.Fatal("a different key opened the value")
	}
}

// Nil-safe, so a caller holding an unconfigured cipher can ask rather than
// guard — and must still be told no, not handed an empty string.
func TestUnconfiguredRefusesRatherThanReturningEmpty(t *testing.T) {
	var c *Cipher
	if c.Enabled() {
		t.Fatal("a nil Cipher reports enabled")
	}
	if _, err := c.Seal("x"); err == nil {
		t.Fatal("Seal succeeded with no key")
	}
	if _, err := c.Open([]byte("x")); err == nil {
		t.Fatal("Open succeeded with no key")
	}
}

func TestColumns(t *testing.T) {
	t.Run("no key stores what it always did", func(t *testing.T) {
		var c *Cipher
		plain, sealed, err := c.Columns("tok")
		if err != nil || plain == nil || *plain != "tok" || sealed != nil {
			t.Fatalf("Columns = (%v, %v, %v), want the plaintext and no sealed value", plain, sealed, err)
		}
	})
	t.Run("a key clears the plaintext column", func(t *testing.T) {
		c := configured(t)
		plain, sealed, err := c.Columns("tok")
		if err != nil {
			t.Fatalf("Columns: %v", err)
		}
		// The point of the change: after this write there is no readable copy.
		if plain != nil {
			t.Fatalf("plaintext column = %q, want null", *plain)
		}
		got, err := c.Open(sealed)
		if err != nil || got != "tok" {
			t.Fatalf("Open(sealed) = (%q, %v), want the token back", got, err)
		}
	})
	t.Run("an empty token is not sealed", func(t *testing.T) {
		c := configured(t)
		plain, sealed, err := c.Columns("")
		if err != nil || plain == nil || *plain != "" || sealed != nil {
			t.Fatalf("Columns(\"\") = (%v, %v, %v), want the empty string unchanged", plain, sealed, err)
		}
	})
}
