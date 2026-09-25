package jobmetrics

import (
	"errors"
	"testing"

	dto "github.com/prometheus/client_model/go"
)

// A job a full queue turned away is counted, not only logged (#2874): a
// stalled worker fills its queue first, and that is the moment to alert.
func TestDroppedAndFailedJobsAreCounted(t *testing.T) {
	const job = "test worker"
	dropped := count(t, runs.WithLabelValues(job, "dropped"))
	failed := count(t, runs.WithLabelValues(job, "error"))

	Dropped(job)
	Ran(job, errors.New("context deadline exceeded"))

	if got := count(t, runs.WithLabelValues(job, "dropped")); got != dropped+1 {
		t.Errorf("dropped = %v, want %v", got, dropped+1)
	}
	if got := count(t, runs.WithLabelValues(job, "error")); got != failed+1 {
		t.Errorf("error = %v, want %v", got, failed+1)
	}
}

func count(t *testing.T, c interface{ Write(*dto.Metric) error }) float64 {
	t.Helper()
	var m dto.Metric
	if err := c.Write(&m); err != nil {
		t.Fatal(err)
	}
	return m.GetCounter().GetValue()
}
