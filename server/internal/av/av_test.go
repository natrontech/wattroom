package av

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

type allowAll struct{}

func (allowAll) Authorize(*http.Request, string) (protocol.Rider, error) {
	return protocol.Rider{ID: "jan-id", Name: "Jan", Role: "owner"}, nil
}

type denyAll struct{}

func (denyAll) Authorize(*http.Request, string) (protocol.Rider, error) {
	return protocol.Rider{}, errors.New("no")
}

func service(access Access) *Service {
	s := New(Config{URL: "ws://localhost:7880", Key: "devkey", Secret: "secret"}, access, slog.New(slog.DiscardHandler))
	s.now = func() time.Time { return time.Unix(1_000_000, 0) }
	return s
}

func TestTokenShape(t *testing.T) {
	// The claim shape is LiveKit's contract; hand-rolled, so pinned hard.
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/rooms/velvet/av-token", nil)
	req.SetPathValue("slug", "velvet")
	w := httptest.NewRecorder()
	service(allowAll{}).handleToken(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("token: %d %s", w.Code, w.Body.String())
	}
	var res struct{ URL, Token string }
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(res.Token, ".")
	if len(parts) != 3 {
		t.Fatalf("not a JWT: %q", res.Token)
	}

	// Verify the signature ourselves — the mint must sign what it says.
	mac := hmac.New(sha256.New, []byte("secret"))
	mac.Write([]byte(parts[0] + "." + parts[1]))
	want := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if parts[2] != want {
		t.Fatalf("bad signature")
	}

	raw, _ := base64.RawURLEncoding.DecodeString(parts[1])
	var got claims
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	// The identity is per connection, not per rider (#293) — but the rider is
	// still readable out of it, because everything server-side keys on that.
	if got.Iss != "devkey" || got.Video.Room != "velvet" || !got.Video.RoomJoin {
		t.Fatalf("claims: %+v", got)
	}
	if RiderID(got.Sub) != "jan-id" || got.Sub == "jan-id" {
		t.Fatalf("identity %q is not jan-id plus a nonce", got.Sub)
	}
	if got.Exp-got.Nbf != int64((6 * time.Hour).Seconds()) {
		t.Fatalf("lifetime: %d", got.Exp-got.Nbf)
	}
}

func TestNonMemberRefused(t *testing.T) {
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/rooms/velvet/av-token", nil)
	req.SetPathValue("slug", "velvet")
	w := httptest.NewRecorder()
	service(denyAll{}).handleToken(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("stranger got an AV token: %d", w.Code)
	}
}

func TestFromEnvGates(t *testing.T) {
	if _, ok := FromEnv(); ok {
		t.Fatalf("AV configured out of thin air")
	}
	t.Setenv("WATTROOM_LIVEKIT_URL", "ws://localhost:7880")
	t.Setenv("WATTROOM_LIVEKIT_KEY", "devkey")
	t.Setenv("WATTROOM_LIVEKIT_SECRET", "secret")
	if _, ok := FromEnv(); !ok {
		t.Fatalf("AV not configured with all three set")
	}
}

func TestEject(t *testing.T) {
	var gotPath, gotAuth string
	var gotBody map[string]string
	var removed []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "ListParticipants") {
			// Bob is in from two tabs; Kim is somebody else entirely.
			_, _ = w.Write([]byte(`{"participants":[{"identity":"bob-id#aaa","name":"Bob"},` +
				`{"identity":"bob-id#bbb","name":"Bob"},{"identity":"kim-id#ccc","name":"Kim"}]}`))
			return
		}
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		removed = append(removed, gotBody["identity"])
	}))
	defer srv.Close()

	// The config carries the ws:// signalling URL; Eject must find the twirp
	// API on the same host over http.
	s := New(Config{URL: "ws" + strings.TrimPrefix(srv.URL, "http"), Key: "devkey", Secret: "secret"},
		denyAll{}, slog.New(slog.DiscardHandler))
	s.now = func() time.Time { return time.Unix(1_000_000, 0) }
	s.Eject("velvet", "bob-id")

	// Every one of the banned rider's tabs goes (#293) — leaving one behind
	// leaves them on camera — and nobody else's. Order is LiveKit's map, so
	// sort before comparing.
	slices.Sort(removed)
	if !slices.Equal(removed, []string{"bob-id#aaa", "bob-id#bbb"}) {
		t.Fatalf("removed %v, want both of bob's connections and only those", removed)
	}
	if gotPath != "/twirp/livekit.RoomService/RemoveParticipant" {
		t.Fatalf("path: %q", gotPath)
	}
	if gotBody["room"] != "velvet" {
		t.Fatalf("body: %v", gotBody)
	}
	token, ok := strings.CutPrefix(gotAuth, "Bearer ")
	if !ok {
		t.Fatalf("auth header: %q", gotAuth)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("not a JWT: %q", token)
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var got claims
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if !got.Video.RoomAdmin || got.Video.Room != "velvet" || got.Video.RoomJoin {
		t.Fatalf("admin grant: %+v", got.Video)
	}
}
