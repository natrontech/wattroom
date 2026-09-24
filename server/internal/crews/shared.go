package crews

import (
	"crypto/rand"
	"errors"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5/pgconn"
)

// crewRefJSON is a crew as a write answers it: what it is called and what it
// looks like, its code, and what the caller is to it. The web's `RoomCrew`
// shape, named for the room it used to hang off (#2446).
type crewRefJSON struct {
	Id   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon,omitempty"`
	// The crew's logo (#1237), when one is set: the mark every surface draws
	// before falling back to the icon, then the initial.
	ImageURL string `json:"imageUrl,omitempty"`
	// The crew's join code (#1236), members only.
	Code string `json:"code,omitempty"`
	// Founded by the caller (#1928): "your own crew", even once they own
	// another.
	Founded bool `json:"founded,omitempty"`
	// What the caller is to the crew: owner | admin | member.
	Role string `json:"role,omitempty"`
	// A person has named it (#1151): until then it carries the owner's name
	// and the set-up step stays open.
	Named bool `json:"named,omitempty"`
}

// randomCode draws from an alphabet with no 0/O/1/I/L — codes get read out
// loud across a room over trainer noise.
func randomCode(length int) string {
	const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failing means the platform is broken
	}
	// Rejection sampling (#1673): 256 mod 31 is 8, so a plain modulo drew
	// the first eight letters 9/256 of the time and the rest 8/256.
	const unbiased = 256 - 256%len(alphabet)
	for i := range b {
		for int(b[i]) >= unbiased {
			if _, err := rand.Read(b[i : i+1]); err != nil {
				panic(err)
			}
		}
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// hasControl reports a line break or another control character in text a
// mail will carry as a subject (#1640).
func hasControl(text string) bool {
	return strings.ContainsFunc(text, unicode.IsControl)
}
