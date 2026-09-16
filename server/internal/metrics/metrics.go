// Package metrics owns the one registry every WattRoom metric is registered
// into (#1738).
//
// It exists because the old arrangement asserted a property it could not hold.
// `/metrics` was mounted on the public mux under a comment saying no slug or
// rider could reach it "by construction" — but the construction was a
// convention: `promauto` registers into the DEFAULT registry from any package,
// so any later package could add a labelled collector without touching
// main.go, and `jobmetrics` already had. The default registry also carries the
// Go runtime's own collectors, so build info, GC statistics and the process
// start time went out with them, unauthenticated.
//
// One registry this package owns makes "no label names a room or a rider"
// checkable: every metric in the server is declared in a package that
// registers here, and metrics_test.go reads those declarations against a
// reviewed list instead of trusting a comment.
package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Registry is where WattRoom's own metrics live. Use `promauto.With(Registry)`
// in a package's var block, the way hub and jobmetrics do.
var Registry = prometheus.NewRegistry()

func init() {
	// The runtime's own, asked for rather than inherited: an operator's
	// dashboard expects go_build_info and process_start_time_seconds, and
	// naming them here is what keeps the list of what this endpoint publishes
	// a list somebody wrote.
	Registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		collectors.NewBuildInfoCollector(),
	)
}

// Handler serves the registry, and only it.
func Handler() http.Handler {
	return promhttp.HandlerFor(Registry, promhttp.HandlerOpts{})
}
