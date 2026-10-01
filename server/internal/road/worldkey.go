package road

import (
	"crypto/hmac"
	"crypto/sha256"
)

// WorldKey is the one key every world's secrets derive from (#3225,
// ADR-0081): the 32 bytes the world_key migration wrote. A secret is derived,
// never stored, so a route or a zone needs no secret column. Replacing the
// key changes every world, cached chunk and photo seed.
type WorldKey []byte

// SecretBytes is a served secret's length: the 16 bytes $lib/world/place's
// saltOf reads.
const SecretBytes = 16

// derive is the first SecretBytes of HMAC-SHA256(key, label || 0 || id). The
// zero keeps "route" + "1x" and "route1" + "x" apart.
func (k WorldKey) derive(label, id string) []byte {
	mac := hmac.New(sha256.New, k)
	mac.Write([]byte(label))
	mac.Write([]byte{0})
	mac.Write([]byte(id))
	return mac.Sum(nil)[:SecretBytes]
}

// RouteSecret keys a route's world for every rider it is served to.
func (k WorldKey) RouteSecret(route string) []byte { return k.derive("route", route) }

// RegionSecret keys one private region — a route's hidden end, a zone —
// for its owner alone.
func (k WorldKey) RegionSecret(kind, id string) []byte { return k.derive("region:"+kind, id) }

// WorldSecret keys the shared world outside every private region.
func (k WorldKey) WorldSecret() []byte { return k.derive("world", "") }
