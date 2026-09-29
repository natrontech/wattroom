package road

import (
	"encoding/hex"
	"testing"
)

// The derivation is part of every world (#3225): change a label or the
// separator and every world, cached chunk and photo seed changes with it. So
// it is pinned to vectors computed apart from this code (Python's hmac over
// the same bytes), for a key of 0x00..0x1f.
func TestWorldSecretsAreTheGoldenOnes(t *testing.T) {
	k := WorldKey(make([]byte, 32))
	for i := range k {
		k[i] = byte(i)
	}
	const route = "3f2a9c1e-0000-4000-8000-000000000001"
	for _, c := range []struct {
		name string
		got  []byte
		want string
	}{
		{"a route's", k.RouteSecret(route), "c8746de273c14c65da59d563366dfc1c"},
		{"a hidden end's", k.RegionSecret("end", route+"/start"), "3cc032515ff371e4839099812c9a87e4"},
		{"the world's", k.WorldSecret(), "3dd01925fb5af0d3f9e5f54f040f2141"},
	} {
		if hex.EncodeToString(c.got) != c.want {
			t.Errorf("%s secret is %x, want %s", c.name, c.got, c.want)
		}
	}
	if hex.EncodeToString(k.RegionSecret("end", route+"/start")) == hex.EncodeToString(k.RegionSecret("zone", route+"/start")) {
		t.Error("two kinds of region with one id share a secret")
	}
}
