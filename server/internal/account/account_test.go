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
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/rooms"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
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

// User is what rooms.UserSource asks for beyond Sessions — the purge hands
// crews on through the real rooms service, so it is wired in here too.
func (f *fakeUsers) User(r *http.Request) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	return u, ok
}

type harness struct {
	mux   *http.ServeMux
	store *store.Store
	users *fakeUsers
}

func setup(t *testing.T) *harness {
	t.Helper()
	st := storetest.Open(t)

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
			// Rooms and crews first: crews.owner_id is ON DELETE RESTRICT, so
			// a user who made a room through the API owns a crew and cannot
			// go until it does (ADR-0038).
			_, _ = st.Pool.Exec(context.Background(), "delete from rooms where owner_id = $1", u.ID)
			_, _ = st.Pool.Exec(context.Background(), "delete from crews where owner_id = $1", u.ID)
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
	}

	mux := http.NewServeMux()
	svc := New(st, users, slog.New(slog.DiscardHandler))
	svc.SetCrews(rooms.New(st, users, slog.New(slog.DiscardHandler)))
	svc.Register(mux)
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
		Slug: "account-test-" + owner, Name: "Account Test", OwnerID: h.id(owner),
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

// createRecap seeds one finished session naming every rider given, the way
// the hub writes it (ADR-0034): presence and time, nothing else.
func (h *harness) createRecap(t *testing.T, room pgtype.UUID, riders ...string) {
	t.Helper()
	entries := make([]map[string]any, 0, len(riders))
	for i, name := range riders {
		entries = append(entries, map[string]any{
			"id": store.UUIDString(h.id(name)), "rider": name,
			"from": 1_700_000_000_000 + int64(i)*60_000, "to": 1_700_003_600_000,
			"rode": true,
		})
	}
	blob, err := json.Marshal(entries)
	if err != nil {
		t.Fatalf("recap riders: %v", err)
	}
	started := pgtype.Timestamptz{Time: time.UnixMilli(1_700_000_000_000), Valid: true}
	ended := pgtype.Timestamptz{Time: time.UnixMilli(1_700_003_600_000), Valid: true}
	if _, err := h.store.Queries.SaveSessionRecap(t.Context(), db.SaveSessionRecapParams{
		RoomID: room, Workout: "Openers", StartedAt: started, EndedAt: ended, Riders: blob,
	}); err != nil {
		t.Fatalf("save recap: %v", err)
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
	// Everything the export learned to carry (#696) has to leave with them too
	// — the second half of the same promise.
	"chat_messages": "select count(*) from chat_messages where user_id = $1",
	"playlists":     "select count(*) from playlists where user_id = $1",
	"session_rsvps": "select count(*) from session_rsvps where user_id = $1",
	"workouts":      "select count(*) from workouts where owner_id = $1",
	"xp_events":     "select count(*) from xp_events where user_id = $1",
	"achievements":  "select count(*) from achievements where user_id = $1",
	// A session recap is one shared row naming several riders (ADR-0034), so
	// the purge does not delete it — it rewrites it. A ghost interval saying
	// "someone left at 19:40" is still a record of a person, which is why
	// this counts rows that NAME the rider rather than rows they own.
	"session_recaps": "select count(*) from session_recaps where riders @> jsonb_build_array(jsonb_build_object('id', $1::text))",
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
	h.createRecap(t, room, "alice", "bob")
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
	// The recap itself survives — it is the room's, and bob was there. What
	// leaves with alice is her interval inside it, asserted on the row rather
	// than through an endpoint.
	if n := h.count(t, userRowQueries["session_recaps"], "bob"); n != 1 {
		t.Errorf("bob should still be named in the session recap, is in %d", n)
	}
	var recaps int
	if err := h.store.Pool.QueryRow(t.Context(), "select count(*) from session_recaps where room_id = $1", room).Scan(&recaps); err != nil || recaps != 1 {
		t.Errorf("the recap row itself should survive alice's purge: %d %v", recaps, err)
	}
	var rooms int
	if err := h.store.Pool.QueryRow(t.Context(), "select count(*) from rooms where id = $1", room).Scan(&rooms); err != nil || rooms != 1 {
		t.Errorf("bob's room should survive alice's purge: %d %v", rooms, err)
	}
}

// ADR-0038's second amendment, at the purge: a rider who owns a crew can
// still leave. Their own rooms go with them as before; a crew holding only
// those is deleted, and one still holding other people's rooms is handed to
// the person left in it — never cascaded, never left ownerless.
func TestDeleteHandsTheCrewOnBeforeTheRowGoes(t *testing.T) {
	h := setup(t)
	crew, err := h.store.Queries.CreateCrew(t.Context(), db.CreateCrewParams{Name: "alice", OwnerID: h.id("alice")})
	if err != nil {
		t.Fatalf("crew: %v", err)
	}
	t.Cleanup(func() { _, _ = h.store.Pool.Exec(context.Background(), "delete from crews where id = $1", crew.ID) })
	own := h.createRoom(t, "alice")
	theirs := h.createRoom(t, "bob")
	for _, room := range []pgtype.UUID{own, theirs} {
		if err := h.store.Queries.PlaceRoomInCrew(t.Context(), db.PlaceRoomInCrewParams{ID: room, CrewID: crew.ID, CrewVisible: true}); err != nil {
			t.Fatalf("place: %v", err)
		}
	}
	if err := h.store.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{RoomID: theirs, UserID: h.id("bob"), Role: "owner"}); err != nil {
		t.Fatalf("bob's membership: %v", err)
	}

	if rec := h.call(t, "alice", http.MethodDelete, "/api/me"); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	if n := h.count(t, userRowQueries["users"], "alice"); n != 0 {
		t.Fatalf("alice was not purged")
	}
	after, err := h.store.Queries.GetCrew(t.Context(), crew.ID)
	if err != nil {
		t.Fatalf("the crew went with its owner although bob's room stood in it: %v", err)
	}
	if after.OwnerID != h.id("bob") {
		t.Errorf("the crew passed to %s, want bob", store.UUIDString(after.OwnerID))
	}
	var rooms int
	if err := h.store.Pool.QueryRow(t.Context(), "select count(*) from rooms where id = $1", theirs).Scan(&rooms); err != nil || rooms != 1 {
		t.Errorf("bob's room should survive alice's purge: %d %v", rooms, err)
	}

	// And a crew holding only the departing rider's rooms simply goes.
	lone, err := h.store.Queries.CreateCrew(t.Context(), db.CreateCrewParams{Name: "carol", OwnerID: h.id("carol")})
	if err != nil {
		t.Fatalf("crew: %v", err)
	}
	room := h.createRoom(t, "carol")
	if err := h.store.Queries.PlaceRoomInCrew(t.Context(), db.PlaceRoomInCrewParams{ID: room, CrewID: lone.ID, CrewVisible: true}); err != nil {
		t.Fatalf("place: %v", err)
	}
	if rec := h.call(t, "carol", http.MethodDelete, "/api/me"); rec.Code != http.StatusNoContent {
		t.Fatalf("delete carol: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := h.store.Queries.GetCrew(t.Context(), lone.ID); err == nil {
		t.Errorf("a crew with nothing left to own survived its owner's purge")
	}
}

func TestExportStreamsEveryRideWithoutHoldingThemAll(t *testing.T) {
	// #894: the blobs used to be read as one slice and held across both
	// loops, so a rider's whole history sat in memory at once. They are read
	// one at a time now — every ride still has to reach the zip, and still
	// only the rider's own.
	h := setup(t)
	room := h.createRoom(t, "bob")
	first := `[{"t":0,"w":180}]`
	second := `[{"t":0,"w":250}]`
	h.createRide(t, "alice", room, "Openers", gzipped(t, first))
	h.createRide(t, "alice", room, "Threshold", gzipped(t, second))
	h.createRide(t, "bob", room, "Bob's Ride", gzipped(t, `[{"t":0,"w":999}]`))

	rec := h.call(t, "alice", http.MethodGet, "/api/me/export")
	if rec.Code != http.StatusOK {
		t.Fatalf("export: %d %s", rec.Code, rec.Body.String())
	}
	zr, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatalf("body is not a zip: %v", err)
	}
	var samples []string
	for _, f := range zr.File {
		if !strings.HasPrefix(f.Name, "samples/") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", f.Name, err)
		}
		body, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			t.Fatalf("read %s: %v", f.Name, err)
		}
		samples = append(samples, string(body))
	}
	sort.Strings(samples)
	if len(samples) != 2 || samples[0] != first || samples[1] != second {
		t.Errorf("want both of alice's rides and neither of bob's, got %q", samples)
	}
}

// #696: the export used to be the profile and the rides, while the privacy
// page and WATTROOM.md promised everything. What must be in it is decided by
// GDPR Art. 15 / revFADP Art. 25 (access: everything held) rather than by
// taste — and the third-party line is drawn at what the rider can already see
// in the app, attributed by display name and nothing else.
func TestExportCarriesEveryCategoryTheLawAsksFor(t *testing.T) {
	h := setup(t)
	room := h.createRoom(t, "alice")
	for _, name := range []string{"alice", "bob"} {
		if err := h.store.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
			RoomID: room, UserID: h.id(name), Role: "member",
		}); err != nil {
			t.Fatalf("membership %s: %v", name, err)
		}
	}
	mustChat := func(user, text string) {
		t.Helper()
		if _, err := h.store.Queries.SaveChatMessage(t.Context(), db.SaveChatMessageParams{
			RoomID: room, UserID: h.id(user), Text: text,
		}); err != nil {
			t.Fatalf("chat %s: %v", user, err)
		}
	}
	mustChat("alice", "starting in five")
	mustChat("bob", "bobs own line")
	h.befriend(t, "alice", "bob")
	// Alice asked carol, and carol dismissed (#1654): told to alice, so hers.
	if err := h.store.Queries.NoteFriendDecline(t.Context(), db.NoteFriendDeclineParams{
		RequesterID: h.id("alice"), AddresseeID: h.id("carol"),
	}); err != nil {
		t.Fatalf("decline: %v", err)
	}
	h.sendDm(t, "alice", "bob", "see you at 7")
	h.sendDm(t, "bob", "alice", "bring legs")
	if _, err := h.store.Queries.CreatePlaylist(t.Context(), db.CreatePlaylistParams{
		UserID: h.id("alice"), Name: "Threshold bangers",
	}); err != nil {
		t.Fatalf("playlist: %v", err)
	}
	if _, err := h.store.Queries.CreateWorkout(t.Context(), db.CreateWorkoutParams{
		OwnerID: h.id("alice"), Name: "My Openers", Author: "alice",
		Definition: []byte(`{"name":"My Openers","steps":[]}`),
	}); err != nil {
		t.Fatalf("workout: %v", err)
	}
	planned, err := h.store.Queries.CreateScheduledSession(t.Context(), db.CreateScheduledSessionParams{
		RoomID: room, WorkoutName: "Sweet Spot", WorkoutJson: []byte(`{}`),
		StartsAt:  pgtype.Timestamptz{Time: time.Now().Add(24 * time.Hour), Valid: true},
		CreatedBy: h.id("alice"),
	})
	if err != nil {
		t.Fatalf("scheduled session: %v", err)
	}
	if err := h.store.Queries.SetRsvp(t.Context(), db.SetRsvpParams{
		SessionID: planned.ID, UserID: h.id("alice"),
	}); err != nil {
		t.Fatalf("rsvp: %v", err)
	}
	if _, err := h.store.Queries.AddXpEvent(t.Context(), db.AddXpEventParams{
		UserID: h.id("alice"), Source: "lounge", Amount: 5, Ref: "bucket-1",
		At: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}); err != nil {
		t.Fatalf("xp: %v", err)
	}
	if _, err := h.store.Queries.AwardAchievement(t.Context(), db.AwardAchievementParams{
		UserID: h.id("alice"), Key: "first-ride",
		EarnedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}); err != nil {
		t.Fatalf("achievement: %v", err)
	}
	medalRide := h.createRide(t, "alice", room, "Openers", gzipped(t, `[]`))
	if err := h.store.Queries.CreateMedal(t.Context(), db.CreateMedalParams{
		RoomID: room, UserID: h.id("alice"), RideID: medalRide, Kind: "diesel",
	}); err != nil {
		t.Fatalf("medal: %v", err)
	}

	rec := h.call(t, "alice", http.MethodGet, "/api/me/export")
	if rec.Code != http.StatusOK {
		t.Fatalf("export: %d %s", rec.Code, rec.Body.String())
	}
	zr, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatalf("body is not a zip: %v", err)
	}
	files := map[string]string{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", f.Name, err)
		}
		body, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			t.Fatalf("read %s: %v", f.Name, err)
		}
		files[f.Name] = string(body)
	}

	// Every category, and the content that proves the query ran rather than
	// an empty array being written.
	for name, want := range map[string]string{
		"chat.json":     "starting in five",
		"messages.json": "bring legs",
		"friends.json":  "bob",
		// The ask of alice's that carol dismissed (#1654).
		"dismissed-requests.json": "carol",
		"playlists.json":          "Threshold bangers",
		"planned-sessions.json":   "Sweet Spot",
		"rooms.json":              "account-test-alice",
		"workouts.json":           "My Openers",
		"xp.json":                 "bucket-1",
		"trophies.json":           "first-ride",
		"medals.json":             "diesel",
		// Every field the ride page shows (#1550).
		"rides.json": "\"sharedWithFriends\"",
		// Written last, naming every category: its presence is what says
		// the archive was not cut short (#1550).
		"manifest.json": "\"complete\": true",
	} {
		body, ok := files[name]
		if !ok {
			t.Errorf("the export has no %s", name)
			continue
		}
		if !strings.Contains(body, want) {
			t.Errorf("%s does not carry %q:\n%s", name, want, body)
		}
	}

	// The line: someone else's room-chat line is their personal data, not the
	// requester's, and it is not in here.
	if strings.Contains(files["chat.json"], "bobs own line") {
		t.Errorf("the export carries another rider's chat line:\n%s", files["chat.json"])
	}
	// A DM thread is both people's, and alice can already read every line of
	// it in the app — so the whole thread is hers to take.
	if !strings.Contains(files["messages.json"], "see you at 7") {
		t.Errorf("the export dropped alice's own DM:\n%s", files["messages.json"])
	}
	// Nobody else's account id or email rides along.
	if strings.Contains(files["friends.json"], store.UUIDString(h.id("bob"))) {
		t.Errorf("the export carries another rider's account id:\n%s", files["friends.json"])
	}
}
