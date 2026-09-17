package testx

import "crypto/rand"

// CrewCode is an invite code for a crew a test founds directly through the
// store, for the many tests that need a crew to exist and do not care what
// its door says. crews_code is a unique index and crews_code_present makes
// the column mandatory, so a fixture needs a value and it must be its own:
// every package in one `go test ./...` shares a database and the next run
// reuses it (#2083), so "unique within this test" is not enough.
//
// Deliberately not protocol.CrewCodeLen characters. Six is what a rider
// types, and six random characters collide often enough to matter in a
// database nothing sweeps; a code's length changes no behaviour anywhere
// (friends.go only reads it to word a 404). A test that needs a
// rider-shaped code passes its own.
func CrewCode() *string {
	code := rand.Text()
	return &code
}
