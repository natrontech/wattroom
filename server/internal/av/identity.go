package av

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

// A LiveKit participant is one browser tab, not one person (#293).
//
// Joining twice under the same identity makes LiveKit evict the session
// already in the room; the evicted tab reconnects and evicts the other, and
// two tabs trade the slot every second forever. So the identity a token
// carries is the rider id plus a per-connection nonce, and everything that
// needs the person parses it back off.
const identitySep = "#"

// newIdentity mints one connection's LiveKit identity. The nonce only has to
// separate one rider's own tabs, never to be unguessable — the rider id in
// front of it is what the server signed, and the grant is what authorizes.
func newIdentity(riderID string) (string, error) {
	nonce := make([]byte, 6)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return riderID + identitySep + hex.EncodeToString(nonce), nil
}

// RiderID is the person behind a participant identity. An identity without a
// nonce — the server-to-server admin token, or one minted before #293 and
// still connected — is its own rider id.
func RiderID(identity string) string {
	if rider, _, ok := strings.Cut(identity, identitySep); ok {
		return rider
	}
	return identity
}
