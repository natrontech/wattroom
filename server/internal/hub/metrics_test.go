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
	if !strings.Contains(rec.Body.String(), "wattroom_room_riding ") {
		t.Error("wattroom_room_riding is not on /metrics — registerRidingMetric is writing to a registry nothing serves")
	}
}
