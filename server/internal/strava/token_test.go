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
// merely checked (#697). It is stored sealed or not at all (#1038), and the
// database never holds a usable copy.

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
func storedToken(t *testing.T, st *store.Store) (sealed []byte) {
	t.Helper()
	row := st.Pool.QueryRow(context.Background(),
		"select refresh_token_enc from identities where provider = 'strava' and provider_user_id = 'athlete-1'")
	if err := row.Scan(&sealed); err != nil {
		t.Fatalf("read identity: %v", err)
	}
	return sealed
}

// A row with nothing sealed has no token (#1038): the rider is told what any
// rider without a stored grant is.
func TestAnUnsealedRowHasNoToken(t *testing.T) {
	st, _, _ := seedRide(t, "strava-unsealed")
	if _, err := st.Pool.Exec(t.Context(),
		"update identities set refresh_token_enc = null where provider = 'strava' and provider_user_id = 'athlete-1'"); err != nil {
		t.Fatal(err)
	}
	ident, err := st.Queries.GetIdentity(t.Context(), db.GetIdentityParams{
		Provider: "strava", ProviderUserID: "athlete-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{store: st, log: slog.New(slog.DiscardHandler), keys: testKeys}
	if got, err := svc.refreshToken(ident); err == nil || !strings.Contains(err.Error(), "no refresh token stored") {
		t.Fatalf("refreshToken = (%q, %v), want no token stored", got, err)
	}
}

// Strava rotates the refresh token on every use, so the write after a refresh
// is the one that decides whether the database holds a readable credential.
func TestRefreshLeavesNothingReadable(t *testing.T) {
	st, _, _ := seedRide(t, "strava-sealed")
	srv, _, _ := fakeStrava(t)
	svc := newService(st, srv)

	ident, err := st.Queries.GetIdentity(t.Context(), db.GetIdentityParams{
		Provider: "strava", ProviderUserID: "athlete-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.freshToken(t.Context(), ident); err != nil {
		t.Fatal(err)
	}

	if sealed := storedToken(t, st); strings.Contains(string(sealed), "refresh-2") {
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

// The tests above hand the service its key directly, which is how New dropped
// it from #697 on and nobody saw: every sealed row failed to open in
// production the first time a deployment actually set WATTROOM_TOKEN_KEY
// (#2999). This one goes through the constructor main.go uses.
func TestNewKeepsTheKey(t *testing.T) {
	t.Setenv("WATTROOM_OAUTH_STRAVA_ID", "id")
	t.Setenv("WATTROOM_OAUTH_STRAVA_SECRET", "secret")
	keys := cipherWith(t, 6)
	sealed, err := keys.SealToken("refresh-1")
	if err != nil {
		t.Fatal(err)
	}

	svc := New(nil, slog.New(slog.DiscardHandler), keys)
	got, err := svc.refreshToken(db.Identity{RefreshTokenEnc: sealed})
	if err != nil || got != "refresh-1" {
		t.Fatalf("refreshToken = (%q, %v), want the sealed token opened", got, err)
	}
}

// Without a key there is nowhere to keep a refresh token (#1038), so Strava
// is absent rather than a connection that fails at its first refresh.
func TestNewWithoutAKeyIsAbsent(t *testing.T) {
	t.Setenv("WATTROOM_OAUTH_STRAVA_ID", "id")
	t.Setenv("WATTROOM_OAUTH_STRAVA_SECRET", "secret")
	if svc := New(nil, slog.New(slog.DiscardHandler), nil); svc != nil {
		t.Fatal("Strava is configured on a server with no token key")
	}
}

// A wrong or rotated key must read as "cannot open this", never as "no token
// stored" — the second would tell every rider to reconnect their Strava
// account over an operator's mistake.
func TestWrongKeyIsNotMistakenForNoToken(t *testing.T) {
	st, _, _ := seedRide(t, "strava-wrong-key")

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
