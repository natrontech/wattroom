// Package jobmetrics is what a background job leaves behind for the
// operator: a run counter by outcome and the time of its last success. Until
// this, a loop that stopped — panic budget spent, a hung statement — left
// nothing to alert on, and the first report was a rider weeks later (audit
// 2026-09-09). ADR-0019's own rule: alert on the subsystems that go quiet
// first.
//
// Labels are job names — constants in this codebase — never a room or a
// rider: metrics stay aggregate by architecture, and a scraper cannot sign in.
package jobmetrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	runs = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "wattroom_job_runs_total",
		Help: "Background job runs, by job and outcome (ok | error).",
	}, []string{"job", "outcome"})
	lastSuccess = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "wattroom_job_last_success_timestamp_seconds",
		Help: "Unix time of each background job's last run that ended without error.",
	}, []string{"job"})
)

// Ran records one run of a named job. Call it at the bottom of the loop
// body, once per run, whatever happened.
func Ran(job string, err error) {
	outcome := "ok"
	if err != nil {
		outcome = "error"
	}
	runs.WithLabelValues(job, outcome).Inc()
	if err == nil {
		lastSuccess.WithLabelValues(job).SetToCurrentTime()
	}
}
