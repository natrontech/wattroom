package routes

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
)

func (h *harness) worldKey(t *testing.T) road.WorldKey {
	t.Helper()
	key, err := h.store.Queries.GetWorldKey(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	return road.WorldKey(key)
}

// secretOf reads a served secret: base64, SecretBytes long.
func secretOf(t *testing.T, v any) []byte {
	t.Helper()
	s, _ := v.(string)
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil || len(b) != road.SecretBytes {
		t.Fatalf("a served secret %q is not %d bytes of base64 (%v)", s, road.SecretBytes, err)
	}
	return b
}

// The migration writes the key exactly once (#3225): its own insert, run
// again, writes nothing and leaves the key as it was, and the table holds one
// row whatever anyone inserts.
func TestTheWorldKeyIsWrittenOnce(t *testing.T) {
	h := setup(t, nil)
	before := h.worldKey(t)
	if len(before) != 32 {
		t.Fatalf("the world key is %d bytes, want 32", len(before))
	}
	raw, err := os.ReadFile("../store/migrations/20260929214018_world_key.sql")
	if err != nil {
		t.Fatal(err)
	}
	insert := regexp.MustCompile(`(?s)insert into world_key.*?;`).FindString(string(raw))
	if insert == "" {
		t.Fatal("the migration has no insert to run again")
	}
	tag, err := h.store.Pool.Exec(t.Context(), insert)
	if err != nil || tag.RowsAffected() != 0 {
		t.Fatalf("the migration's insert run again wrote %d rows (%v), want none", tag.RowsAffected(), err)
	}
	if _, err := h.store.Pool.Exec(t.Context(), "insert into world_key (key) values ($1)", bytes.Repeat([]byte{7}, 32)); err == nil {
		t.Fatal("a second world key was written")
	}
	var rows int
	if err := h.store.Pool.QueryRow(t.Context(), "select count(*) from world_key").Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("world_key holds %d rows (%v), want 1", rows, err)
	}
	if !bytes.Equal(h.worldKey(t), before) {
		t.Fatal("the world key changed")
	}
}

// The same id is the same secret across a restart: a second store over the
// same database derives what the first did.
func TestASecretOutlivesARestart(t *testing.T) {
	h := setup(t, nil)
	again, err := storetest.Open(t).Queries.GetWorldKey(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	const route = "3f2a9c1e-0000-4000-8000-000000000001"
	if !bytes.Equal(h.worldKey(t).RouteSecret(route), road.WorldKey(again).RouteSecret(route)) {
		t.Fatal("a route's secret changed across a restart")
	}
}

// The owner's /shape carries the route's secret and each hidden end with its
// own (#3225): where it lies on the road, and its owner-only secret. Nobody
// else reads the route at all — someone else's is a 404, as it always was.
func TestTheOwnersShapeCarriesTheWorldsSecrets(t *testing.T) {
	h := setup(t, testKey(t, "k"))
	id := h.keep(t, "alice")
	key := h.worldKey(t)
	status, body := h.call(t, "alice", http.MethodGet, "/api/routes/"+id+"/shape", nil)
	if status != http.StatusOK || body["shape"] != shape {
		t.Fatalf("the owner's shape: %d %v", status, body)
	}
	if !bytes.Equal(secretOf(t, body["secret"]), key.RouteSecret(id)) {
		t.Error("the served route secret is not the route's")
	}
	regions, _ := body["regions"].([]any)
	want := []struct {
		from, to float64
		id       string
	}{{0, protocol.RouteHiddenEndM, id + "/start"}, {3000 - protocol.RouteHiddenEndM, 3000, id + "/finish"}}
	if len(regions) != len(want) {
		t.Fatalf("%d private regions, want the two hidden ends: %v", len(regions), regions)
	}
	for i, w := range want {
		r, _ := regions[i].(map[string]any)
		if r["kind"] != "end" || r["fromM"] != w.from || r["toM"] != w.to {
			t.Errorf("region %d is %v, want an end from %v to %v m", i, r, w.from, w.to)
		}
		if !bytes.Equal(secretOf(t, r["secret"]), key.RegionSecret("end", w.id)) {
			t.Errorf("region %d's secret is not its own", i)
		}
	}
	for _, c := range []struct {
		name, user, path string
		want             int
	}{
		{"signed out", "", "/api/routes/" + id + "/shape", http.StatusUnauthorized},
		{"someone else's, not ridden with them", "bob", "/api/routes/" + id + "/shape", http.StatusForbidden},
		{"none at all", "alice", "/api/routes/00000000-0000-4000-8000-000000000001/shape", http.StatusNotFound},
		{"not an id", "alice", "/api/routes/nope/shape", http.StatusBadRequest},
	} {
		if status, _ := h.call(t, c.user, http.MethodGet, c.path, nil); status != c.want {
			t.Errorf("%s: %d, want %d", c.name, status, c.want)
		}
	}
}

// The world's secret is every signed-in rider's (ADR-0081).
func TestTheWorldSecretIsEverySignedInRiders(t *testing.T) {
	h := setup(t, nil)
	for _, who := range []string{"alice", "bob"} {
		status, body := h.call(t, who, http.MethodGet, "/api/world", nil)
		if status != http.StatusOK || !bytes.Equal(secretOf(t, body["secret"]), h.worldKey(t).WorldSecret()) {
			t.Errorf("%s reads the world: %d %v", who, status, body)
		}
	}
	if status, _ := h.call(t, "", http.MethodGet, "/api/world", nil); status != http.StatusUnauthorized {
		t.Errorf("signed out: %d, want 401", status)
	}
}

// A private region's secret is its owner's alone (#3225): no payload a crew
// is sent — a workout's cut, a session's pick, the road a session rides —
// carries one, in any spelling a client could decode.
func TestNoCrewPayloadCarriesARegionSecret(t *testing.T) {
	h := setup(t, testKey(t, "k"))
	route := h.keep(t, "alice")
	alice, bob := h.users.ByToken["alice"].ID, h.users.ByToken["bob"].ID
	a := NewAttacher(h.store.Queries, h.keys)

	cut, err := a.Attach(t.Context(), workoutOn(route), bob)
	if err != nil {
		t.Fatal(err)
	}
	picked, refusal, err := a.ForSession(t.Context(), store.UUIDString(alice), workoutOn(route))
	if err != nil || refusal != "" {
		t.Fatalf("the owner's pick: %q %v", refusal, err)
	}
	rode, profile, refused, err := a.SessionRoute(t.Context(), store.UUIDString(alice), route)
	if err != nil || refused != nil {
		t.Fatalf("the session's road: %+v %v", refused, err)
	}
	ridden, err := json.Marshal(map[string]any{"route": rode, "profile": profile})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range hiddenEnds(h.worldKey(t), route, 3000) {
		for _, spelling := range []string{base64.StdEncoding.EncodeToString(r.Secret), hex.EncodeToString(r.Secret)} {
			for name, payload := range map[string]string{"a workout's cut": cut, "a session's pick": picked, "a session's road": string(ridden)} {
				if strings.Contains(payload, spelling) {
					t.Errorf("%s carries a hidden end's secret: %s", name, payload)
				}
			}
		}
	}
}
