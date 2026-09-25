package auth

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

// liveDrops stands in for the hub, recording what an ended session asks it
// to close (#2807). The handlers call it synchronously, so no lock.
type liveDrops struct {
	users    []droppedUser
	sessions [][]byte
}

type droppedUser struct {
	id   string
	keep []byte
}

func (*liveDrops) SetProfile(string, string, int, int) {}

func (l *liveDrops) DropUser(userID string, keep []byte) {
	l.users = append(l.users, droppedUser{userID, keep})
}

func (l *liveDrops) DropSession(session []byte) { l.sessions = append(l.sessions, session) }

func liveService(t *testing.T) (*Service, *liveDrops) {
	t.Helper()
	s := testService(t)
	live := &liveDrops{}
	s.SetLive(live)
	return s, live
}

func logoutEverywhere(t *testing.T, s *Service, cookie *http.Cookie) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/auth/logout-everywhere", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	s.handleLogoutEverywhere(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("logout everywhere: %d %s", w.Code, w.Body.String())
	}
}

// Sign out everywhere (#1607) is ADR-0030's answer to "a passkey was added",
// and ending the rows left every open socket of the ended sessions receiving
// the crew's live data (#2807): the hub is told to drop the rider, sparing the
// session that asked.
func TestLogoutEverywhereDropsTheOtherSessionsLive(t *testing.T) {
	s, live := liveService(t)
	user := testUser(t, s)
	here := signedIn(t, s, user)
	signedIn(t, s, user)

	logoutEverywhere(t, s, here)

	if len(live.users) != 1 {
		t.Fatalf("hub asked to drop %d times, want once: %+v", len(live.users), live.users)
	}
	got := live.users[0]
	if got.id != store.UUIDString(user.ID) || !bytes.Equal(got.keep, hash(here.Value)) {
		t.Fatalf("dropped %s sparing %x, want %s sparing this session", got.id, got.keep, store.UUIDString(user.ID))
	}
}

// Nothing else signed in, nothing ended — and nothing to drop: the call would
// only take the asking screen out of voice for its drop-rejoin to bring back.
func TestLogoutEverywhereAloneDropsNothing(t *testing.T) {
	s, live := liveService(t)
	user := testUser(t, s)

	logoutEverywhere(t, s, signedIn(t, s, user))

	if len(live.users) != 0 {
		t.Fatalf("hub asked to drop with no other session ended: %+v", live.users)
	}
}

// Removing a credential signs the rest out too (#1607) — whoever added it
// may hold a session — and takes their sockets with them.
func TestRemovingAPasskeyDropsTheOtherSessionsLive(t *testing.T) {
	s, live := liveService(t)
	user := testUser(t, s)
	here := signedIn(t, s, user)
	signedIn(t, s, user)
	addPasskey(t, s, user, "kept-credential", "Phone")
	removed := addPasskey(t, s, user, "removed-credential", "YubiKey")

	if w := deletePasskey(t, s, here, removed); w.Code != http.StatusNoContent {
		t.Fatalf("remove a passkey: %d %s", w.Code, w.Body.String())
	}

	if len(live.users) != 1 || !bytes.Equal(live.users[0].keep, hash(here.Value)) {
		t.Fatalf("hub drops after a passkey removal: %+v, want one sparing this session", live.users)
	}
}

// Signing out one tab ends the session every tab of that browser shares, so
// the hub closes that session's sockets — only that session's.
func TestLogoutDropsThatSessionLive(t *testing.T) {
	s, live := liveService(t)
	user := testUser(t, s)
	cookie := signedIn(t, s, user)

	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/auth/logout", nil)
	req.AddCookie(cookie)
	s.handleLogout(httptest.NewRecorder(), req)

	if len(live.sessions) != 1 || !bytes.Equal(live.sessions[0], hash(cookie.Value)) {
		t.Fatalf("hub session drops after a logout: %x, want this session's", live.sessions)
	}
	if len(live.users) != 0 {
		t.Fatalf("a one-tab logout dropped the whole rider: %+v", live.users)
	}
}
