// Package testx holds the test doubles every package used to write for
// itself (consolidation sweep 2026-09-09, #1696): sixteen identical
// fakeUsers, two of them answering 401 with a hand-typed body.
package testx

import (
	"net/http"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Users authenticates a request by its X-Test-User header: the token is
// the key, the value is the rider. An absent or unknown token is signed out.
type Users struct{ ByToken map[string]db.User }

func (u *Users) User(r *http.Request) (db.User, bool) {
	user, ok := u.ByToken[r.Header.Get("X-Test-User")]
	return user, ok
}

func (u *Users) RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool) {
	user, ok := u.User(r)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", signInMessage)
	}
	return user, ok
}
