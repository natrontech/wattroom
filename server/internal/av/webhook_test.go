package av

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeSink struct {
	joined, left map[string][]string
	cams         map[string][]string
	closed       []string
	rooms        []string
	synced       map[string]map[string]string
}

func (f *fakeSink) VoiceJoined(slug, identity, name string) {
	f.joined[slug] = append(f.joined[slug], identity+"/"+name)
}
func (f *fakeSink) VoiceLeft(slug, identity string) {
	f.left[slug] = append(f.left[slug], identity)
}
func (f *fakeSink) VoiceCam(slug, identity string, on bool) {
	if f.cams == nil {
		f.cams = map[string][]string{}
	}
	f.cams[slug] = append(f.cams[slug], fmt.Sprintf("%s/%t", identity, on))
}
func (f *fakeSink) VoiceRoomClosed(slug string) { f.closed = append(f.closed, slug) }
func (f *fakeSink) VoiceRooms() []string        { return f.rooms }
func (f *fakeSink) VoiceSync(slug string, present map[string]string, _ time.Time) {
	if f.synced == nil {
		f.synced = map[string]map[string]string{}
	}
	f.synced[slug] = present
}

func signWebhook(t *testing.T, secret string, iss string, body []byte) string {
	t.Helper()
	sum := sha256.Sum256(body)
	enc := func(v any) string {
		raw, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return base64.RawURLEncoding.EncodeToString(raw)
	}
	signing := enc(map[string]string{"alg": "HS256", "typ": "JWT"}) + "." +
		enc(map[string]any{
			"iss": iss, "exp": time.Now().Add(time.Minute).Unix(),
			"sha256": base64.StdEncoding.EncodeToString(sum[:]),
		})
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signing))
	return signing + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func TestWebhookFeedsTheRadar(t *testing.T) {
	sink := &fakeSink{joined: map[string][]string{}, left: map[string][]string{}}
	svc := New(Config{URL: "ws://x", Key: "devkey", Secret: "secret"}, nil, slog.New(slog.DiscardHandler))
	svc.SetVoiceSink(sink)
	mux := http.NewServeMux()
	svc.RegisterWebhook(mux)

	post := func(auth string, body []byte) int {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/livekit/webhook", bytes.NewReader(body))
		req.Header.Set("Authorization", auth)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		return w.Code
	}

	join := []byte(`{"event":"participant_joined","room":{"name":"velvet-hammer"},"participant":{"identity":"u1","name":"Jan"}}`)
	if code := post(signWebhook(t, "secret", "devkey", join), join); code != http.StatusOK {
		t.Fatalf("join event: %d", code)
	}
	leave := []byte(`{"event":"participant_left","room":{"name":"velvet-hammer"},"participant":{"identity":"u1"}}`)
	if code := post(signWebhook(t, "secret", "devkey", leave), leave); code != http.StatusOK {
		t.Fatalf("leave event: %d", code)
	}
	// Camera on/off rides track events (#251); a mic publish is not a camera.
	camOn := []byte(`{"event":"track_published","room":{"name":"velvet-hammer"},"participant":{"identity":"u1"},"track":{"type":"VIDEO","source":"CAMERA"}}`)
	if code := post(signWebhook(t, "secret", "devkey", camOn), camOn); code != http.StatusOK {
		t.Fatalf("cam on event: %d", code)
	}
	camOff := []byte(`{"event":"track_unpublished","room":{"name":"velvet-hammer"},"participant":{"identity":"u1"},"track":{"type":"VIDEO","source":"CAMERA"}}`)
	if code := post(signWebhook(t, "secret", "devkey", camOff), camOff); code != http.StatusOK {
		t.Fatalf("cam off event: %d", code)
	}
	mic := []byte(`{"event":"track_published","room":{"name":"velvet-hammer"},"participant":{"identity":"u1"},"track":{"type":"AUDIO","source":"MICROPHONE"}}`)
	if code := post(signWebhook(t, "secret", "devkey", mic), mic); code != http.StatusOK {
		t.Fatalf("mic event: %d", code)
	}
	done := []byte(`{"event":"room_finished","room":{"name":"velvet-hammer"}}`)
	if code := post(signWebhook(t, "secret", "devkey", done), done); code != http.StatusOK {
		t.Fatalf("finish event: %d", code)
	}
	if got := sink.joined["velvet-hammer"]; len(got) != 1 || got[0] != "u1/Jan" {
		t.Fatalf("joined: %v", got)
	}
	if got := sink.left["velvet-hammer"]; len(got) != 1 || got[0] != "u1" {
		t.Fatalf("left: %v", got)
	}
	if len(sink.closed) != 1 || sink.closed[0] != "velvet-hammer" {
		t.Fatalf("closed: %v", sink.closed)
	}
	if got := sink.cams["velvet-hammer"]; len(got) != 2 || got[0] != "u1/true" || got[1] != "u1/false" {
		t.Fatalf("cams: %v", got)
	}

	// Forgeries bounce: wrong secret, wrong issuer, tampered body.
	if code := post(signWebhook(t, "wrong", "devkey", join), join); code != http.StatusUnauthorized {
		t.Fatalf("wrong secret: %d", code)
	}
	if code := post(signWebhook(t, "secret", "eve", join), join); code != http.StatusUnauthorized {
		t.Fatalf("wrong issuer: %d", code)
	}
	if code := post(signWebhook(t, "secret", "devkey", join), leave); code != http.StatusUnauthorized {
		t.Fatalf("tampered body: %d", code)
	}
}
