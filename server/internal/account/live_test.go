package account

import (
	"net/http"
	"testing"

	"github.com/natrontech/wattroom/server/internal/store"
)

// liveDrops stands in for the hub, recording who a purge asks it to drop.
type liveDrops struct{ users []string }

func (l *liveDrops) DropUser(userID string, keep []byte) {
	if len(keep) != 0 {
		userID += " sparing a session"
	}
	l.users = append(l.users, userID)
}

// A deleted rider's open tab went on receiving the crew's watts and heart
// rate, and stood on the roster and in the call under its old name (#2807):
// once the purge commits, the hub drops every socket and call they hold.
func TestDeleteDropsTheRiderLive(t *testing.T) {
	h := setup(t)
	live := &liveDrops{}
	h.svc.SetLive(live)

	if rec := h.call(t, "", http.MethodDelete, "/api/me"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned delete: %d", rec.Code)
	}
	if len(live.users) != 0 {
		t.Fatalf("a refused delete dropped %v", live.users)
	}

	if rec := h.call(t, "alice", http.MethodDelete, "/api/me"); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	if want := store.UUIDString(h.id("alice")); len(live.users) != 1 || live.users[0] != want {
		t.Fatalf("hub drops after alice's purge: %v, want %s sparing nothing", live.users, want)
	}
}
