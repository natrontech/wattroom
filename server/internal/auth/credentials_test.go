package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

type fakeRevoker struct {
	called db.Identity
	calls  int
	err    error
}

func (f *fakeRevoker) RevokeGrant(_ context.Context, ident db.Identity) error {
	f.calls++
	f.called = ident
	return f.err
}

func linkIdentity(t *testing.T, s *Service, user db.User, provider, external string) {
	t.Helper()
	if err := s.store.Queries.CreateIdentity(t.Context(), db.CreateIdentityParams{
		Provider: provider, ProviderUserID: external, UserID: user.ID,
	}); err != nil {
		t.Fatalf("create identity: %v", err)
	}
}

func disconnect(t *testing.T, s *Service, cookie *http.Cookie, provider string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodDelete, "/api/me/identities/"+provider, nil)
	req.SetPathValue("provider", provider)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	s.handleDisconnectProvider(w, req)
	return w
}

func TestDisconnectProvider(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	linkIdentity(t, s, user, "github", "disconnect-github")
	linkIdentity(t, s, user, "google", "disconnect-google")

	if w := disconnect(t, s, cookie, "github"); w.Code != http.StatusNoContent {
		t.Fatalf("disconnect = %d, want 204: %s", w.Code, w.Body.String())
	}
	if _, err := s.store.Queries.GetUserIdentity(t.Context(), db.GetUserIdentityParams{
		UserID: user.ID, Provider: "github",
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("identity still present after disconnect: %v", err)
	}

	// Google is now the only way in.
	if w := disconnect(t, s, cookie, "google"); w.Code != http.StatusConflict {
		t.Fatalf("disconnecting the last credential = %d, want 409: %s", w.Code, w.Body.String())
	}
}

// A passkey counts, so a rider with one provider and one passkey can drop the
// provider — the same invariant the passkey path enforces (ADR-0029).
func TestDisconnectProviderCountsPasskeys(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	linkIdentity(t, s, user, "github", "disconnect-with-passkey")
	addPasskey(t, s, user, "keeps-them-in", "Phone")

	if w := disconnect(t, s, cookie, "github"); w.Code != http.StatusNoContent {
		t.Fatalf("provider backed by a passkey = %d, want 204: %s", w.Code, w.Body.String())
	}
}

func TestDisconnectProviderRejections(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	linkIdentity(t, s, user, "github", "disconnect-rejections")
	linkIdentity(t, s, user, "google", "disconnect-rejections-2")

	if w := disconnect(t, s, cookie, "strava"); w.Code != http.StatusNotFound {
		t.Errorf("provider that is not connected = %d, want 404", w.Code)
	}
	if w := disconnect(t, s, nil, "github"); w.Code != http.StatusUnauthorized {
		t.Errorf("no session = %d, want 401", w.Code)
	}
}

// Strava's grant goes back to Strava, not just out of our table.
func TestDisconnectStravaRevokesTheGrant(t *testing.T) {
	s := testService(t)
	revoker := &fakeRevoker{}
	s.SetStravaRevoker(revoker)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	linkIdentity(t, s, user, "strava", "revoke-me")
	linkIdentity(t, s, user, "github", "revoke-me-backup")

	if w := disconnect(t, s, cookie, "strava"); w.Code != http.StatusNoContent {
		t.Fatalf("disconnect = %d: %s", w.Code, w.Body.String())
	}
	if revoker.calls != 1 || revoker.called.ProviderUserID != "revoke-me" {
		t.Fatalf("grant not handed back: %+v", revoker)
	}
}

// Strava being down must not leave a rider connected to something they asked
// to remove — and still holding a token we can no longer refresh for them.
func TestDisconnectStravaProceedsWhenRevokeFails(t *testing.T) {
	s := testService(t)
	s.SetStravaRevoker(&fakeRevoker{err: errors.New("strava is down")})
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	linkIdentity(t, s, user, "strava", "revoke-fails")
	linkIdentity(t, s, user, "github", "revoke-fails-backup")

	if w := disconnect(t, s, cookie, "strava"); w.Code != http.StatusNoContent {
		t.Fatalf("disconnect with a failing revoke = %d, want 204: %s", w.Code, w.Body.String())
	}
	if _, err := s.store.Queries.GetUserIdentity(t.Context(), db.GetUserIdentityParams{
		UserID: user.ID, Provider: "strava",
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("row survived a failed revoke: %v", err)
	}
}
