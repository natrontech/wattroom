package metrics_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	_ "github.com/natrontech/wattroom/server/internal/hub"
	_ "github.com/natrontech/wattroom/server/internal/jobmetrics"
	"github.com/natrontech/wattroom/server/internal/metrics"
	_ "github.com/natrontech/wattroom/server/internal/safego"
	_ "github.com/natrontech/wattroom/server/internal/secrets"
	_ "github.com/natrontech/wattroom/server/internal/usage"
)

// The handler serves that registry and what this package deliberately adds to
// it, rather than whatever the default one accrued.
func TestTheHandlerServesTheRegistry(t *testing.T) {
	rec := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/metrics", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("metrics = %d", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{"wattroom_room_riders", "wattroom_accounts", "go_build_info", "process_start_time_seconds"} {
		if !strings.Contains(body, want) {
			t.Errorf("the metrics page does not carry %s", want)
		}
	}
}
