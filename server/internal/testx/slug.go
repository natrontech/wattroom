package testx

import (
	"crypto/rand"
	"strings"
)

// Slug is a room slug for a test that founds a room directly through the
// store. rooms.slug is unique across the whole database, and the database is
// shared the same two ways crews_code is (CrewCode says how): every package
// in one `go test ./...` writes to it, and the next run reuses what the last
// one left. So a constant ("chat-room"), a counter that restarts at 1
// ("open-1") and t.Name() are all only unique *within a test* — they survive
// exactly as long as every cleanup runs, and a Ctrl-C on `make test` is
// enough to leave one behind and turn the package permanently red.
//
// prefix is what a human reads in psql when one does survive; the random
// tail is what makes the row this run's.
func Slug(prefix string) string {
	return strings.ToLower(prefix + "-" + rand.Text())
}
