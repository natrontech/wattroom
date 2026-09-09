package gamify

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

type fakeUsers struct{ byToken map[string]db.User }

func (f *fakeUsers) User(r *http.Request) (db.User, bool) {
	u, ok := f.byToken[r.Header.Get("X-Test-User")]
	return u, ok
}

// setup opens the test database (skipping without one) and returns a
// service over it plus two riders, alice and bob, deleted on cleanup.
func setup(t *testing.T) (*Service, *fakeUsers, db.User, db.User) {
	t.Helper()
	st := storetest.Open(t)

	users := &fakeUsers{byToken: map[string]db.User{}}
	newUser := func(name string) db.User {
		u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
			DisplayName: name, FtpWatts: 250, WeightKg: 70,
		})
		if err != nil {
			t.Fatalf("create user: %v", err)
		}
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
		})
		users.byToken[name] = u
		return u
	}
	alice, bob := newUser("alice"), newUser("bob")
	s := New(st, users, slog.New(slog.DiscardHandler))
	return s, users, alice, bob
}

func addRide(t *testing.T, s *Service, user db.User, startedAt time.Time, seconds, kj, xp int) {
	t.Helper()
	curve, _ := json.Marshal(map[string]int{"best5s": 500, "best1m": 350, "best5m": 300, "best20m": 260})
	_, err := s.store.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: user.ID, WorkoutName: "test ride",
		StartedAt: pgtype.Timestamptz{Time: startedAt, Valid: true},
		Seconds:   int32(seconds), AvgWatts: 200, Kj: int32(kj), Execution: 0.9, FtpWatts: user.FtpWatts, //nolint:gosec // test values
		Samples: []byte("x"), Curve: curve, Xp: int32(xp), //nolint:gosec // test values
	})
	if err != nil {
		t.Fatalf("create ride: %v", err)
	}
}

func sources(t *testing.T, s *Service, user db.User) map[string]db.XpBySourceRow {
	t.Helper()
	rows, err := s.store.Queries.XpBySource(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("xp by source: %v", err)
	}
	out := make(map[string]db.XpBySourceRow, len(rows))
	for _, row := range rows {
		out[row.Source] = row
	}
	return out
}

func earned(t *testing.T, s *Service, user db.User) map[string]bool {
	t.Helper()
	rows, err := s.store.Queries.ListUserAchievements(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("achievements: %v", err)
	}
	out := make(map[string]bool, len(rows))
	for _, row := range rows {
		out[row.Key] = true
	}
	return out
}

// roomSeq keeps the 6-char code and the slug unique across the package —
// both are unique columns and the rooms outlive nothing but their test.
var roomSeq atomic.Int32

// shareRoom puts the riders in a fresh room (the first one owns it) and
// returns its id, so a test can ban one of them afterwards.
func shareRoom(t *testing.T, s *Service, members ...db.User) pgtype.UUID {
	t.Helper()
	n := roomSeq.Add(1)
	room, err := s.store.Queries.CreateRoom(t.Context(), db.CreateRoomParams{
		Slug:    fmt.Sprintf("trophy-room-%d", n),
		Name:    "Trophy Room",
		OwnerID: members[0].ID,
	})
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	t.Cleanup(func() {
		_, _ = s.store.Pool.Exec(context.Background(), "delete from rooms where id = $1", room.ID)
	})
	for i, m := range members {
		role := "member"
		if i == 0 {
			role = "owner"
		}
		if err := s.store.Queries.CreateMembership(t.Context(), db.CreateMembershipParams{
			RoomID: room.ID, UserID: m.ID, Role: role,
		}); err != nil {
			t.Fatalf("membership: %v", err)
		}
	}
	return room.ID
}

func ban(t *testing.T, s *Service, room pgtype.UUID, user db.User) {
	t.Helper()
	if _, err := s.store.Queries.UpdateMembershipRole(t.Context(), db.UpdateMembershipRoleParams{
		RoomID: room, UserID: user.ID, Role: "banned",
	}); err != nil {
		t.Fatalf("ban: %v", err)
	}
}

func befriend(t *testing.T, s *Service, a, b db.User) {
	t.Helper()
	if err := s.store.Queries.CreateFriendRequest(t.Context(), db.CreateFriendRequestParams{
		RequesterID: a.ID, AddresseeID: b.ID,
	}); err != nil {
		t.Fatalf("friend request: %v", err)
	}
	if _, err := s.store.Queries.AcceptFriendRequest(t.Context(), db.AcceptFriendRequestParams{
		RequesterID: a.ID, AddresseeID: b.ID,
	}); err != nil {
		t.Fatalf("accept: %v", err)
	}
}
