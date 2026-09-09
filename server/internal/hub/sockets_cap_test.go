package hub

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// One account cannot hold the hub open with sockets (#1415): the seventeenth
// is refused before the upgrade, and a closed one frees its slot.
func TestSocketsPerRiderAreCapped(t *testing.T) {
	h := New(slog.New(slog.DiscardHandler), fakeAccess{}, nil)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/rooms/{slug}", h.HandleWS)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/rooms/crowded"

	conns := make([]*websocket.Conn, 0, maxSocketsPerRider)
	for i := 0; i < maxSocketsPerRider; i++ {
		conns = append(conns, dial(t, url, "many:member"))
	}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	_, res, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: http.Header{"X-Rider": []string{"many:member"}}})
	if res != nil && res.Body != nil {
		defer func() { _ = res.Body.Close() }()
	}
	if err == nil || res == nil || res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("the seventeenth socket: err=%v status=%v, want a 503 before the upgrade", err, res)
	}
	// Another rider is not affected.
	dial(t, url, "someone-else:member")
	// Closing one frees a slot.
	_ = conns[0].CloseNow()
	eventually(t, "a slot freed", func() bool {
		h.mu.Lock()
		defer h.mu.Unlock()
		return h.sockets["many"] < maxSocketsPerRider
	})
	dial(t, url, "many:member")
}
