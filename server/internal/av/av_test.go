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
	if got.Iss != "devkey" || got.Sub != "jan-id" || got.Video.Room != "velvet" || !got.Video.RoomJoin {
		t.Fatalf("claims: %+v", got)
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
