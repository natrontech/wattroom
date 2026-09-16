package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

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

// Two removals at once (#824): a passkey and a provider, both reading "two
// credentials" before either delete landed, used to leave zero — an account
// nobody can sign into. The row lock makes the second wait and count one.
func TestConcurrentRemovalsKeepOneCredential(t *testing.T) {
	s := testService(t)
	for round := 0; round < 8; round++ {
		user := testUser(t, s)
		cookie := signedIn(t, s, user)
		stamp := fmt.Sprintf("race-%d-%d", round, time.Now().UnixNano())
		linkIdentity(t, s, user, "github", stamp)
		key := addPasskey(t, s, user, stamp, "Phone")

		var wg sync.WaitGroup
		var provider, passkey *httptest.ResponseRecorder
		wg.Add(2)
		go func() { defer wg.Done(); provider = disconnect(t, s, cookie, "github") }()
		go func() { defer wg.Done(); passkey = deletePasskey(t, s, cookie, key) }()
		wg.Wait()

		total, err := s.store.Queries.CountUserCredentials(t.Context(), user.ID)
		if err != nil {
			t.Fatal(err)
		}
		if total == 0 {
			t.Fatalf("round %d: both removals went through (%d and %d) — the account has no way in", round, provider.Code, passkey.Code)
		}
		if (provider.Code == http.StatusNoContent) == (passkey.Code == http.StatusNoContent) {
			t.Fatalf("round %d: exactly one removal may succeed, got %d and %d", round, provider.Code, passkey.Code)
		}
	}
}

// Disconnecting Strava takes the activity ids Strava issued (#1507).
// WATTROOM.md binds §7.4 — everything goes within 30 days of deauthorization
// — and `ride_exports.remote_id` had no delete on any path but a full account
// purge, so a rider who disconnected and stayed left them behind for good.
//
// The row itself stays: that the ride was delivered is our own bookkeeping
// about a ride we recorded, and the ride page reads it.
func TestDisconnectingStravaForgetsItsActivityIds(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	other := testUser(t, s)
	cookie := signedIn(t, s, user)
	linkIdentity(t, s, user, "strava", "disconnect-strava")
	linkIdentity(t, s, user, "github", "disconnect-strava-keeps-github")
	linkIdentity(t, s, other, "strava", "another-riders-strava")

	delivered := func(owner db.User, activity int64) pgtype.UUID {
		t.Helper()
		ride, err := s.store.Queries.CreateRide(t.Context(), db.CreateRideParams{
			UserID: owner.ID, WorkoutName: "Openers",
			StartedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
			Seconds:   60, AvgWatts: 200, Kj: 12, FtpWatts: 200,
			Samples: []byte("{}"), Curve: []byte("{}"),
		})
		if err != nil {
			t.Fatalf("create ride: %v", err)
		}
		if err := s.store.Queries.StartRideExport(t.Context(), db.StartRideExportParams{
			RideID: ride, Destination: "strava",
		}); err != nil {
			t.Fatalf("start export: %v", err)
		}
		if err := s.store.Queries.FinishRideExport(t.Context(), db.FinishRideExportParams{
			RideID: ride, Destination: "strava", RemoteID: &activity,
		}); err != nil {
			t.Fatalf("finish export: %v", err)
		}
		return ride
	}
	mine, theirs := delivered(user, 111222333), delivered(other, 444555666)

	read := func(ride pgtype.UUID) db.GetRideExportRow {
		t.Helper()
		row, err := s.store.Queries.GetRideExport(t.Context(), db.GetRideExportParams{
			RideID: ride, Destination: "strava",
		})
		if err != nil {
			t.Fatalf("read delivery: %v", err)
		}
		return row
	}
	if got := read(mine).RemoteID; got == nil || *got != 111222333 {
		t.Fatalf("the fixture never stored an activity id: %v", got)
	}

	if w := disconnect(t, s, cookie, "strava"); w.Code != http.StatusNoContent {
		t.Fatalf("disconnect = %d, want 204: %s", w.Code, w.Body.String())
	}

	after := read(mine)
	if after.RemoteID != nil {
		t.Errorf("the activity id outlived the grant: %d", *after.RemoteID)
	}
	// The delivery is still a delivery — only the remote's number went.
	if after.State != "delivered" {
		t.Errorf("the delivery record was taken with the id: state %q", after.State)
	}
	// And nobody else's.
	if got := read(theirs).RemoteID; got == nil || *got != 444555666 {
		t.Errorf("another rider's activity id was cleared: %v", got)
	}
}

// The refusal comes first: a rider whose only way in is Strava is told no, and
// nothing is cleared on the way to telling them (#1507 beside #1826's rule).
func TestTheLastCredentialKeepsItsActivityIds(t *testing.T) {
	s := testService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)
	linkIdentity(t, s, user, "strava", "only-strava")

	ride, err := s.store.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: user.ID, WorkoutName: "Openers",
		StartedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		Seconds:   60, AvgWatts: 200, Kj: 12, FtpWatts: 200,
		Samples: []byte("{}"), Curve: []byte("{}"),
	})
	if err != nil {
		t.Fatalf("create ride: %v", err)
	}
	if err := s.store.Queries.StartRideExport(t.Context(), db.StartRideExportParams{
		RideID: ride, Destination: "strava",
	}); err != nil {
		t.Fatalf("start export: %v", err)
	}
	activity := int64(777888999)
	if err := s.store.Queries.FinishRideExport(t.Context(), db.FinishRideExportParams{
		RideID: ride, Destination: "strava", RemoteID: &activity,
	}); err != nil {
		t.Fatalf("finish export: %v", err)
	}

	if w := disconnect(t, s, cookie, "strava"); w.Code != http.StatusConflict {
		t.Fatalf("disconnecting the last credential = %d, want 409: %s", w.Code, w.Body.String())
	}
	row, err := s.store.Queries.GetRideExport(t.Context(), db.GetRideExportParams{
		RideID: ride, Destination: "strava",
	})
	if err != nil {
		t.Fatalf("read delivery: %v", err)
	}
	if row.RemoteID == nil || *row.RemoteID != activity {
		t.Errorf("a refused disconnect cleared the ids anyway: %v", row.RemoteID)
	}
}
