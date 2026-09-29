package rides

import (
	"bytes"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/muktihari/fit/decoder"
	"github.com/muktihari/fit/profile/filedef"
)

// roadRideBody is rideBody on a road: 8 m a second along it, climbing 0.4 m,
// with `edit` given the chance to spoil any sample.
func roadRideBody(seconds int, edit func(i int, m, alt float64) (float64, float64)) string {
	samples := make([]string, seconds)
	for i := range samples {
		m, alt := edit(i, float64(8*i), 1000+0.4*float64(i))
		samples[i] = fmt.Sprintf(`{"watts":200,"cadence":90,"m":%g,"alt":%g}`, m, alt)
	}
	return fmt.Sprintf(
		`{"workoutName":"Openers","workoutJson":"{\"name\":\"Openers\",\"steps\":[{\"type\":\"steady\",\"seconds\":%d,\"target\":0.8}]}","startedAt":%q,"samples":[%s]}`,
		seconds, nextStart().Format(time.RFC3339), strings.Join(samples, ","))
}

// near is false for NaN, which is what an unwritten FIT field reads back as:
// `math.Abs(got-want) > tol` would pass it.
func near(diff, tol float64) bool { return math.Abs(diff) <= tol }

func unchanged(_ int, m, alt float64) (float64, float64) { return m, alt }

// A ride on a road keeps where it was (#3052), and its .fit says how far it
// went, how fast and how high — never where on Earth.
func TestARoadRideKeepsItsDistanceAndHeightInTheFit(t *testing.T) {
	h := setup(t)
	status, got := call(t, h.mux, "alice", http.MethodPost, "/api/rides", roadRideBody(120, unchanged))
	if status != http.StatusCreated {
		t.Fatalf("create: %d %v", status, got)
	}
	w := exportRequest(t, h, "alice", got["id"].(string))
	if w.Code != http.StatusOK {
		t.Fatalf("export: %d %s", w.Code, w.Body.String())
	}
	data, err := io.ReadAll(w.Body)
	if err != nil {
		t.Fatal(err)
	}
	fit, err := decoder.New(bytes.NewReader(data)).Decode()
	if err != nil {
		t.Fatalf("decode FIT: %v", err)
	}
	activity := filedef.NewActivity(fit.Messages...)
	last := activity.Records[119]
	if got := last.DistanceScaled(); !near(got-8*119, 0.01) {
		t.Errorf("distance at the last record = %v m, want %v", got, 8*119)
	}
	if got := last.EnhancedSpeedScaled(); !near(got-8, 0.001) {
		t.Errorf("speed = %v m/s, want 8", got)
	}
	if got := last.EnhancedAltitudeScaled(); !near(got-(1000+0.4*119), 0.2) {
		t.Errorf("altitude = %v m, want %v", got, 1000+0.4*119)
	}
	for i, r := range activity.Records {
		if r.PositionLat != math.MaxInt32 || r.PositionLong != math.MaxInt32 {
			t.Fatalf("record %d carries a position (%d, %d): a road ride's file never does", i, r.PositionLat, r.PositionLong)
		}
	}
	if got := activity.Sessions[0].TotalDistanceScaled(); !near(got-8*119, 0.01) {
		t.Errorf("session distance = %v m, want %v", got, 8*119)
	}
}

func TestARoadRideOutsideTheRoadsBoundsIsRefused(t *testing.T) {
	h := setup(t)
	for _, tc := range []struct {
		name string
		edit func(i int, m, alt float64) (float64, float64)
	}{
		{"backwards", func(i int, m, alt float64) (float64, float64) {
			if i == 60 {
				return m - 20, alt
			}
			return m, alt
		}},
		{"faster than 30 m a second", func(i int, m, alt float64) (float64, float64) {
			if i >= 60 {
				return m + 31, alt
			}
			return m, alt
		}},
		{"higher than any road", func(i int, m, alt float64) (float64, float64) { return m, 9001 }},
		{"below the .fit's floor", func(i int, m, alt float64) (float64, float64) { return m, -501 }},
		{"behind the start", func(i int, m, alt float64) (float64, float64) { return m - 1, alt }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, got := call(t, h.mux, "alice", http.MethodPost, "/api/rides", roadRideBody(120, tc.edit))
			if status != http.StatusBadRequest || got["field"] != "samples" {
				t.Fatalf("got %d %v, want 400 on samples", status, got)
			}
		})
	}
}
