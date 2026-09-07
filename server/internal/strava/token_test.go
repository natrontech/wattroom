package strava

import (
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/secrets"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The refresh token is the only credential stored to be used again rather than
// merely checked (#697). These cover the two things that have to hold while it
// stops being readable: nothing loses its Strava connection on the way, and
// afterwards the database no longer holds a usable copy.

func cipherWith(t *testing.T, fill byte) *secrets.Cipher {
	t.Helper()
	key := make([]byte, 32)
	for i := range key {
		key[i] = fill
	}
	t.Setenv(secrets.KeyEnv, base64.StdEncoding.EncodeToString(key))
	c, err := secrets.FromEnv(slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("FromEnv: %v", err)
	}
	return c
}

// storedToken reads the row back through SQL rather than through the code
// under test, so an assertion about "what is in the database" is exactly that.
func storedToken(t *testing.T, st *store.Store) (plain *string, sealed []byte) {
	t.Helper()
	row := st.Pool.QueryRow(context.Background(),
		"select refresh_token, refresh_token_enc from identities where provider = 'strava' and provider_user_id = 'athlete-1'")
	if err := row.Scan(&plain, &sealed); err != nil {
		t.Fatalf("read identity: %v", err)
	}
	return plain, sealed
}

// The release that turns encryption on meets rows written before it. Those
// have only the plaintext column, and a rider must not be asked to reconnect.
func TestPlaintextRowStillWorksOnceTheKeyExists(t *testing.T) {
	st, _, _ := seedRide(t, "strava-plaintext")
	srv, _, _ := fakeStrava(t)
	svc := newService(st, srv)
	svc.keys = cipherWith(t, 1)

	ident, err := st.Queries.GetIdentity(t.Context(), db.GetIdentityParams{
		Provider: "strava", ProviderUserID: "athlete-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.freshToken(t.Context(), ident); err != nil {
		t.Fatalf("refreshing from a plaintext row: %v", err)
	}

	// And the refresh it just did leaves the new token sealed — the row heals
	// itself the first time it is used, backfill or no backfill.
	plain, sealed := storedToken(t, st)
	if plain != nil {
		t.Fatalf("refresh_token = %q, want null after a sealed write", *plain)
	}
	got, err := svc.keys.Open(sealed)
	if err != nil || got != "refresh-2" {
		t.Fatalf("sealed value = (%q, %v), want the rotated token", got, err)
	}
}

// Strava rotates the refresh token on every use, so the write after a refresh
// is the one that decides whether the database holds a readable credential.
func TestRefreshLeavesNothingReadable(t *testing.T) {
	st, _, _ := seedRide(t, "strava-sealed")
	srv, _, _ := fakeStrava(t)
	svc := newService(st, srv)
	svc.keys = cipherWith(t, 2)

	ident, err := st.Queries.GetIdentity(t.Context(), db.GetIdentityParams{
		Provider: "strava", ProviderUserID: "athlete-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.freshToken(t.Context(), ident); err != nil {
		t.Fatal(err)
	}

	_, sealed := storedToken(t, st)
	if strings.Contains(string(sealed), "refresh-2") {
		t.Fatal("the rotated token is readable in the stored bytes")
	}

	// Read it back the way the next upload will, from the sealed column only.
	ident, err = st.Queries.GetIdentity(t.Context(), db.GetIdentityParams{
		Provider: "strava", ProviderUserID: "athlete-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(ident.RefreshTokenEnc) == 0 {
		t.Fatal("nothing was sealed")
	}
	got, err := svc.refreshToken(ident)
	if err != nil || got != "refresh-2" {
		t.Fatalf("refreshToken = (%q, %v), want the rotated token", got, err)
	}
}

// The backfill is what lets the plaintext column be dropped a release later:
// without it, rows nobody has ridden with keep their credential in the clear.
func TestBackfillSealsRowsWrittenBeforeTheKey(t *testing.T) {
	st, _, _ := seedRide(t, "strava-backfill")
	keys := cipherWith(t, 3)

	plain, sealed := storedToken(t, st)
	if plain == nil || *plain != "refresh-1" || sealed != nil {
		t.Fatalf("fixture is not the pre-key shape: (%v, %v)", plain, sealed)
	}

	secrets.Backfill(context.Background(), st, keys, slog.New(slog.NewTextHandler(io.Discard, nil)))

	plain, sealed = storedToken(t, st)
	if plain != nil {
		t.Fatalf("refresh_token = %q, want null after the backfill", *plain)
	}
	got, err := keys.Open(sealed)
	if err != nil || got != "refresh-1" {
		t.Fatalf("sealed value = (%q, %v), want the original token", got, err)
	}

	// Idempotent: a second boot finds nothing to do and changes nothing.
	before := string(sealed)
	secrets.Backfill(context.Background(), st, keys, slog.New(slog.NewTextHandler(io.Discard, nil)))
	_, sealed = storedToken(t, st)
	if string(sealed) != before {
		t.Fatal("a second backfill rewrote a row it had already sealed")
	}
}

// A wrong or rotated key must read as "cannot open this", never as "no token
// stored" — the second would tell every rider to reconnect their Strava
// account over an operator's mistake.
func TestWrongKeyIsNotMistakenForNoToken(t *testing.T) {
	st, _, _ := seedRide(t, "strava-wrong-key")
	secrets.Backfill(context.Background(), st, cipherWith(t, 4), slog.New(slog.NewTextHandler(io.Discard, nil)))

	ident, err := st.Queries.GetIdentity(t.Context(), db.GetIdentityParams{
		Provider: "strava", ProviderUserID: "athlete-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{store: st, log: slog.New(slog.DiscardHandler), keys: cipherWith(t, 5)}
	_, err = svc.refreshToken(ident)
	if err == nil {
		t.Fatal("a foreign key opened the token")
	}
	if strings.Contains(err.Error(), "no refresh token stored") {
		t.Fatalf("a key problem reported as a missing token: %v", err)
	}
	if !strings.Contains(err.Error(), secrets.KeyEnv) {
		t.Fatalf("the error does not name %s, so nobody knows what to fix: %v", secrets.KeyEnv, err)
	}
}
