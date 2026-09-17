package metrics_test

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	_ "github.com/natrontech/wattroom/server/internal/hub"
	_ "github.com/natrontech/wattroom/server/internal/jobmetrics"
	"github.com/natrontech/wattroom/server/internal/metrics"
	_ "github.com/natrontech/wattroom/server/internal/safego"
	_ "github.com/natrontech/wattroom/server/internal/secrets"
)

// labelledMetric finds a labelled collector's declaration: New…Vec(…, []string
// {"job", "outcome"}). The label slice is the last argument, so the first
// []string after the call opens is the one.
var (
	labelledMetric = regexp.MustCompile(`New\w+Vec\(`)
	labelSlice     = regexp.MustCompile(`\[\]string\{([^}]*)\}`)
	labelName      = regexp.MustCompile(`"([^"]*)"`)
	registersHere  = regexp.MustCompile(`promauto\.With\(metrics\.Registry\)|Registry\.MustRegister`)
	promauto       = regexp.MustCompile(`promauto\.New`)
	// The other door into the default registry, and the one #1738 left open:
	// `prometheus.Register` / `prometheus.MustRegister` are DefaultRegisterer's
	// methods. `metrics.Registry.Register(…)` does not match — the receiver is
	// what tells them apart.
	defaultRegisterer = regexp.MustCompile(`\bprometheus\.(Must)?Register\(`)
)

// The promise the old comment made and could not keep (#1738): nothing on the
// metrics endpoint names a room or a rider. It said "by construction", and the
// construction was a convention — `promauto` writes to the DEFAULT registry
// from any package, and `jobmetrics` had already registered a CounterVec and a
// GaugeVec into it without anyone reviewing the labels.
//
// This reads the DECLARATIONS rather than the registry, which is the half that
// can fail: a vec nobody has incremented yet emits no samples at all, so a
// gather-and-inspect test would pass on the day somebody added
// `{"slug", "rider"}` and pass again every day until it was used.
func TestNoMetricLabelCanNameARoomOrARider(t *testing.T) {
	// The reviewed list. `job` is a constant in this codebase (jobmetrics'
	// own doc) and `outcome` is ok|error.
	allowed := [][]string{{"job", "outcome"}, {"job"}}

	found := 0
	walk(t, func(path, body string) {
		for _, at := range labelledMetric.FindAllStringIndex(body, -1) {
			rest := body[at[1]:]
			labels := labelSlice.FindStringSubmatch(rest)
			if labels == nil {
				t.Errorf("%s: a labelled metric whose label list this test cannot read — declare it as []string{…} beside the others", path)
				continue
			}
			names := []string{}
			for _, m := range labelName.FindAllStringSubmatch(labels[1], -1) {
				names = append(names, m[1])
			}
			found++
			if !slices.ContainsFunc(allowed, func(ok []string) bool { return slices.Equal(ok, names) }) {
				t.Errorf("%s declares a metric labelled %v, which nobody has reviewed.\n"+
					"A label is a free-text key on an endpoint an operator scrapes: if it can hold a room slug or a rider id, it does not belong on a metric (WATTROOM.md — privacy is architecture).\n"+
					"If it genuinely cannot, add it to `allowed` in this test in the same commit.",
					path, names)
			}
		}
	})
	if found == 0 {
		t.Fatal("no labelled metric found anywhere — the scan is broken, not the code")
	}
}

// Every metric registers into this package's registry, so the list above is
// the whole list. A `promauto.New…` without `.With(metrics.Registry)` goes to
// the default registry, where nothing serves it and nothing reviews it.
//
// So does a bare `prometheus.Register`, which is how wattroom_room_riding left
// the endpoint without anything going red (#2321): a GaugeFunc registered
// inside a method, so neither a promauto call nor a var block, in a file whose
// promauto declarations had all been converted.
func TestEveryMetricRegistersIntoTheOneRegistry(t *testing.T) {
	walk(t, func(path, body string) {
		if strings.Contains(path, "internal/metrics/") {
			return // this package registers the runtime's collectors by hand
		}
		if promauto.MatchString(body) && !registersHere.MatchString(body) {
			t.Errorf("%s registers a metric into the default registry — use promauto.With(metrics.Registry)", path)
		}
		if defaultRegisterer.MatchString(body) {
			t.Errorf("%s calls prometheus.Register/MustRegister, which is the DEFAULT registry — nothing serves it.\n"+
				"Register into the one the handler serves: metrics.Registry.Register(…).", path)
		}
	})
}

// The handler serves that registry and what this package deliberately adds to
// it, rather than whatever the default one accrued.
func TestTheHandlerServesTheRegistry(t *testing.T) {
	rec := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/metrics", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("metrics = %d", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{"wattroom_room_riders", "wattroom_identities_plaintext_refresh_tokens", "go_build_info", "process_start_time_seconds"} {
		if !strings.Contains(body, want) {
			t.Errorf("the metrics page does not carry %s", want)
		}
	}
}

// walk hands every non-test Go file under server/ to `check`.
func walk(t *testing.T, check func(path, body string)) {
	t.Helper()
	root := filepath.Join("..", "..")
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		body, err := os.ReadFile(path) //nolint:gosec // walking this repository's own source
		if err != nil {
			return err
		}
		check(filepath.ToSlash(path), string(body))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
