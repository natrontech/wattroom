package hub

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/natrontech/wattroom/server/internal/metrics"
)

// The gauge the deploy guard reads has to be on the endpoint the deploy guard
// scrapes, and nothing asserted the two were the same thing (#2321). #2186
// moved every metric off the default registry onto internal/metrics' own, and
// converted the three promauto declarations in metrics.go while missing the
// prometheus.Register two functions below them — so wattroom_room_riding was
// in the binary, counted correctly, unit-tested, and absent from /metrics from
// 2026.09.118 onward. The updater on the VM fell back to the presence gauge
// and deferred every release for its full two-hour cap.
//
// The value is ridingCount's business (hub_test.go) and is not asserted here:
// the GaugeFunc is registered by the first Hub a process builds and tests
// build many, so which hub the scrape reads is a question about test order.
// That the family reaches the handler at all is the half that broke.
func TestTheRidingGaugeReachesTheMetricsEndpoint(t *testing.T) {
	New(slog.New(slog.DiscardHandler), nil, nil)

	rec := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/metrics", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("metrics = %d", rec.Code)
	}
	for _, gauge := range []string{"wattroom_room_riding ", "wattroom_room_spectators "} {
		if !strings.Contains(rec.Body.String(), gauge) {
			t.Errorf("%sis not on /metrics — registerRideGauges is writing to a registry nothing serves", gauge)
		}
	}
}

// The roadside gauge (#3022) counts sockets watching a running session: not
// the riders on its timeline, and nothing at all while no session runs.
func TestSpectatorsAreSocketsBesideARunningSession(t *testing.T) {
	cases := []struct {
		name  string
		phase string
		want  float64
	}{
		{"running", "running", 2},
		{"paused is not running", "paused", 0},
		{"idle", "idle", 0},
		{"done", "done", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := New(slog.New(slog.DiscardHandler), nil, nil)
			rm := h.room("velvet")
			// The coach rides; Ben watches from a desk and a phone.
			for _, c := range []*client{sock("coach"), sock("ben"), sock("ben")} {
				rm.join(c)
			}
			joinRide(rm, "coach")
			rm.mu.Lock()
			rm.session.phase = tc.phase
			rm.mu.Unlock()
			if got := h.spectatorCount(); got != tc.want {
				t.Fatalf("spectatorCount = %v, want %v", got, tc.want)
			}
		})
	}
}
