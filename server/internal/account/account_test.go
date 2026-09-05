package account

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// fakeUsers resolves the X-Test-User header instead of a session cookie, so
// these tests exercise account, not auth — auth has its own suite. Same shape
// as rooms_test.go's harness, trimmed to the Sessions interface account needs.
type fakeUsers struct{ byToken map[string]db.User }

func (f *fakeUsers) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	if !ok {
		http.Error(w, `{"error":"unauthorized","message":"`+signInMessage+`"}`, http.StatusUnauthorized)
	}
	return u, ok
}

type harness struct {
	mux   *http.ServeMux
	store *store.Store
	users *fakeUsers
}

func setup(t *testing.T) *harness {
	t.Helper()
	dsn := os.Getenv("WATTROOM_TEST_DB")
	if dsn == "" {
		dsn = "postgres://wattroom:wattroom@localhost:5432/wattroom_test" //nolint:gosec // compose test credentials — NEVER the dev db, tests delete users
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	st, err := store.Open(ctx, dsn)
	if err != nil {
		t.Skipf("no database available: %v", err)
	}
	t.Cleanup(st.Close)

	users := &fakeUsers{byToken: map[string]db.User{}}
	for _, name := range []string{"alice", "bob", "carol"} {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
			DisplayName: name, FtpWatts: 200, WeightKg: 75,
		})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		users.byToken[name] = u
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
	}

	mux := http.NewServeMux()
	New(st, users, slog.New(slog.DiscardHandler)).Register(mux)
	return &harness{mux: mux, store: st, users: users}
}

// call runs one request as a user ("" = signed out) and returns the recorder,
// because the export body is a zip, not JSON.
func (h *harness) call(t *testing.T, user, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, nil)
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	w := httptest.NewRecorder()
	h.mux.ServeHTTP(w, req)
	return w
}

func (h *harness) id(name string) pgtype.UUID { return h.users.byToken[name].ID }

// gzipped is a samples blob the way the rides handler stores one.
func gzipped(t *testing.T, raw string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write([]byte(raw)); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func (h *harness) createRoom(t *testing.T, owner string) pgtype.UUID {
	t.Helper()
	room, err := h.store.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Code: "ACCT" + strings.ToUpper(owner[:2]), Slug: "account-test-" + owner, Name: "Account Test", OwnerID: h.id(owner),
	})
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	t.Cleanup(func() {
		_, _ = h.store.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID)
	})
	return room.ID
}

func (h *harness) createRide(t *testing.T, rider string, room pgtype.UUID, workout string, samples []byte) pgtype.UUID {
	t.Helper()
	id, err := h.store.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: h.id(rider), RoomID: room, WorkoutName: workout,
		StartedAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true},
		Seconds:   1800, AvgWatts: 210, Kj: 378, Execution: 0.95, FtpWatts: 200,
		Samples: samples, Curve: []byte(`{"5":320}`), Xp: 378,
	})
	if err != nil {
		t.Fatalf("create ride for %s: %v", rider, err)
	}
	return id
}

func (h *harness) createSession(t *testing.T, user string) {
	t.Helper()
	err := h.store.Queries.CreateSession(t.Context(), db.CreateSessionParams{
		TokenHash: []byte("hash-" + user), UserID: h.id(user),
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
	})
	if err != nil {
		t.Fatalf("create session for %s: %v", user, err)
	}
}

func (h *harness) befriend(t *testing.T, requester, addressee string) {
	t.Helper()
	pair := db.CreateFriendRequestParams{RequesterID: h.id(requester), AddresseeID: h.id(addressee)}
	if err := h.store.Queries.CreateFriendRequest(t.Context(), pair); err != nil {
		t.Fatalf("friend request %s→%s: %v", requester, addressee, err)
	}
	n, err := h.store.Queries.AcceptFriendRequest(t.Context(), db.AcceptFriendRequestParams(pair))
	if err != nil || n != 1 {
		t.Fatalf("accept %s→%s: %d %v", requester, addressee, n, err)
	}
}

func (h *harness) sendDm(t *testing.T, from, to, text string) {
	t.Helper()
	_, err := h.store.Queries.SendDm(t.Context(), db.SendDmParams{SenderID: h.id(from), RecipientID: h.id(to), Text: text})
	if err != nil {
		t.Fatalf("dm %s→%s: %v", from, to, err)
	}
}

// count runs one `select count(*)` with the user id bound as $1.
func (h *harness) count(t *testing.T, query string, user string) int {
	t.Helper()
	var n int
	if err := h.store.Pool.QueryRow(t.Context(), query, h.id(user)).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

// userRowQueries is every table the purge promises to empty for the rider —
// the package doc's list (rides, sessions, identities, memberships, medals)
// plus the social rows that carry their identity (friendships, DMs).
var userRowQueries = map[string]string{
	"users":       "select count(*) from users where id = $1",
	"rides":       "select count(*) from rides where user_id = $1",
	"sessions":    "select count(*) from sessions where user_id = $1",
	"identities":  "select count(*) from identities where user_id = $1",
	"memberships": "select count(*) from memberships where user_id = $1",
	"medals":      "select count(*) from medals where user_id = $1",
	"friendships": "select count(*) from friendships where requester_id = $1 or addressee_id = $1",
	"dm_messages": "select count(*) from dm_messages where sender_id = $1 or recipient_id = $1",
}

func TestExportRequiresSignIn(t *testing.T) {
	h := setup(t)
	if rec := h.call(t, "", http.MethodGet, "/api/me/export"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned export: %d %s", rec.Code, rec.Body.String())
	}
}

func TestExportIsAZipOfTheRidersOwnData(t *testing.T) {
	h := setup(t)
	room := h.createRoom(t, "bob")
	rawSamples := `[{"t":0,"w":200,"hr":140},{"t":1,"w":210,"hr":141}]`
	h.createRide(t, "alice", room, "Openers", gzipped(t, rawSamples))
	h.createRide(t, "bob", room, "Bob's Ride", gzipped(t, `[]`))

	rec := h.call(t, "alice", http.MethodGet, "/api/me/export")
	if rec.Code != http.StatusOK {
		t.Fatalf("export: %d %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/zip" {
		t.Errorf("Content-Type = %q, want application/zip", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.HasPrefix(cd, `attachment; filename="wattroom-export-`) {
		t.Errorf("Content-Disposition = %q", cd)
	}

	zr, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatalf("body is not a zip: %v", err)
	}
	files := map[string][]byte{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", f.Name, err)
		}
		files[f.Name], err = io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			t.Fatalf("read %s: %v", f.Name, err)
		}
	}

	var profile map[string]any
	if err := json.Unmarshal(files["profile.json"], &profile); err != nil {
		t.Fatalf("profile.json: %v (%q)", err, files["profile.json"])
	}
	if profile["displayName"] != "alice" || profile["ftpWatts"] != float64(200) || profile["weightKg"] != float64(75) {
		t.Errorf("profile.json is not alice's: %v", profile)
	}

	var rides []map[string]any
	if err := json.Unmarshal(files["rides.json"], &rides); err != nil {
		t.Fatalf("rides.json: %v (%q)", err, files["rides.json"])
	}
	if len(rides) != 1 || rides[0]["workoutName"] != "Openers" {
		t.Fatalf("rides.json should hold exactly alice's ride, got %v", rides)
	}
	if rides[0]["avgWatts"] != float64(210) || rides[0]["kj"] != float64(378) || rides[0]["xp"] != float64(378) {
		t.Errorf("ride summary fields: %v", rides[0])
	}
	if curve, _ := rides[0]["curve"].(map[string]any); curve["5"] != float64(320) {
		t.Errorf("curve was not embedded as JSON: %v", rides[0]["curve"])
	}

	var samples []string
	for name, body := range files {
		if strings.HasPrefix(name, "samples/") {
			samples = append(samples, string(body))
		}
	}
	if len(samples) != 1 || samples[0] != rawSamples {
		t.Errorf("samples: want one decompressed file %q, got %q", rawSamples, samples)
	}
}

func TestDeleteRequiresSignIn(t *testing.T) {
	h := setup(t)
	if rec := h.call(t, "", http.MethodDelete, "/api/me"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned delete: %d %s", rec.Code, rec.Body.String())
	}
	if n := h.count(t, userRowQueries["users"], "alice"); n != 1 {
		t.Fatalf("an unsigned delete removed a user")
	}
}

func TestDeletePurgesEverythingOfTheRiderAndNothingOfAnyoneElse(t *testing.T) {
	h := setup(t)
	room := h.createRoom(t, "bob")
	for _, name := range []string{"alice", "bob"} {
		err := h.store.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{RoomID: room, UserID: h.id(name), Role: "member"})
		if err != nil {
			t.Fatalf("membership %s: %v", name, err)
		}
		h.createSession(t, name)
		err = h.store.Queries.CreateIdentity(t.Context(), db.CreateIdentityParams{
			Provider: "github", ProviderUserID: "acct-test-" + name, UserID: h.id(name),
		})
		if err != nil {
			t.Fatalf("identity %s: %v", name, err)
		}
		ride := h.createRide(t, name, room, "Openers", gzipped(t, `[]`))
		err = h.store.Queries.CreateMedal(t.Context(), db.CreateMedalParams{RoomID: room, UserID: h.id(name), RideID: ride, Kind: "hammer"})
		if err != nil {
			t.Fatalf("medal %s: %v", name, err)
		}
	}
	h.befriend(t, "alice", "bob")
	h.befriend(t, "bob", "carol")
	h.sendDm(t, "alice", "bob", "see you at 7")
	h.sendDm(t, "bob", "alice", "bring legs")
	h.sendDm(t, "bob", "carol", "unrelated")

	rec := h.call(t, "alice", http.MethodDelete, "/api/me")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}

	// Alice is gone from every table — including the pair rows she shared with bob.
	for table, query := range userRowQueries {
		if n := h.count(t, query, "alice"); n != 0 {
			t.Errorf("%s still holds %d row(s) for the purged user", table, n)
		}
	}

	// Bob keeps everything that is his alone, plus his conversation with carol.
	for _, table := range []string{"users", "rides", "sessions", "identities", "memberships", "medals"} {
		if n := h.count(t, userRowQueries[table], "bob"); n != 1 {
			t.Errorf("%s: bob should keep 1 row, has %d", table, n)
		}
	}
	if n := h.count(t, userRowQueries["friendships"], "bob"); n != 1 {
		t.Errorf("bob should keep his friendship with carol only, has %d", n)
	}
	if n := h.count(t, userRowQueries["dm_messages"], "bob"); n != 1 {
		t.Errorf("bob should keep his DM with carol only, has %d", n)
	}
	var rooms int
	if err := h.store.Pool.QueryRow(t.Context(), "select count(*) from rooms where id = $1", room).Scan(&rooms); err != nil || rooms != 1 {
		t.Errorf("bob's room should survive alice's purge: %d %v", rooms, err)
	}
}
