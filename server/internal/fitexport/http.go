package fitexport

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"time"

	"github.com/natrontech/wattroom/server/internal/httpx"
)

// Bounds on untrusted input. A ride is client-recorded, so the request is
// attacker-controlled: cap what it can allocate before any of it is believed.
const (
	// 6 hours at 1 Hz. Longer than any indoor session anyone rides.
	maxSamples = 6 * 60 * 60
	// Generous ceiling on the JSON body, independent of maxSamples.
	maxBodyBytes = 4 << 20
	// Track sprinters peak near 2000 W; 3000 is the bound AGENTS.md names.
	maxWatts     = 3000
	maxCadence   = 250
	maxHeartRate = 250
)

// The switch in toRide already rejects out-of-range values; these make the
// narrowing provably safe in one guarded step rather than two unguarded casts,
// which is also what satisfies gosec's G115.
func clampU16(v int) uint16 {
	if v < 0 {
		return 0
	}
	if v > math.MaxUint16 {
		return math.MaxUint16
	}
	return uint16(v)
}

func clampU8(v int) uint8 {
	if v < 0 {
		return 0
	}
	if v > math.MaxUint8 {
		return math.MaxUint8
	}
	return uint8(v)
}

type exportRequest struct {
	StartedAt time.Time      `json:"startedAt"`
	Samples   []exportSample `json:"samples"`
}

type exportSample struct {
	Second    int `json:"second"`
	Watts     int `json:"watts"`
	Cadence   int `json:"cadence"`
	HeartRate int `json:"heartRate"`
}

// Handler returns the .fit export endpoint. Stateless: the client owns the ride
// until there is somewhere to persist it (#15), so this encodes and returns.
func Handler(log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)

		var req exportRequest
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&req); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
				"That ride could not be read. This is a bug in the app, not something you did.")
			log.Warn("fit export: bad body", "err", err)
			return
		}

		ride, err := toRide(req)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "validation_error", err.Error())
			return
		}

		data, err := Encode(ride)
		if err != nil {
			// The ride passed validation, so a failure here is ours, not the rider's.
			log.Error("fit export: encode failed", "err", err, "samples", len(ride.Samples))
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
				"Your ride could not be turned into a file. It is still on this device — try again.")
			return
		}

		name := fmt.Sprintf("wattroom-%s.fit", ride.StartedAt.UTC().Format("2006-01-02-1504"))
		w.Header().Set("Content-Type", "application/vnd.ant.fit")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if _, err := w.Write(data); err != nil {
			log.Warn("fit export: write failed", "err", err)
		}
	}
}

// toRide validates untrusted input into a Ride. Every bound is checked here so
// Encode can assume its input is sane.
func toRide(req exportRequest) (Ride, error) {
	switch {
	case req.StartedAt.IsZero():
		return Ride{}, fmt.Errorf("ride is missing a start time")
	case len(req.Samples) == 0:
		return Ride{}, fmt.Errorf("ride has no samples")
	case len(req.Samples) > maxSamples:
		return Ride{}, fmt.Errorf("ride has %d samples, more than the %d supported", len(req.Samples), maxSamples)
	}

	samples := make([]Sample, 0, len(req.Samples))
	for i, s := range req.Samples {
		switch {
		case s.Second < 0:
			return Ride{}, fmt.Errorf("sample %d has a negative time offset", i)
		case s.Watts < 0 || s.Watts > maxWatts:
			return Ride{}, fmt.Errorf("sample %d has %d watts, outside 0–%d", i, s.Watts, maxWatts)
		case s.Cadence < 0 || s.Cadence > maxCadence:
			return Ride{}, fmt.Errorf("sample %d has %d rpm, outside 0–%d", i, s.Cadence, maxCadence)
		case s.HeartRate < 0 || s.HeartRate > maxHeartRate:
			return Ride{}, fmt.Errorf("sample %d has %d bpm, outside 0–%d", i, s.HeartRate, maxHeartRate)
		// Encode enforces this too, but reaching it there yields a 500 — an
		// unordered ride is the caller's mistake, so it is caught at the boundary
		// and reported as one.
		case i > 0 && s.Second <= req.Samples[i-1].Second:
			return Ride{}, fmt.Errorf(
				"samples must be in time order: sample %d is at %ds, after %ds",
				i, s.Second, req.Samples[i-1].Second,
			)
		}
		samples = append(samples, Sample{
			Second:    s.Second,
			Watts:     clampU16(s.Watts),
			Cadence:   clampU8(s.Cadence),
			HeartRate: clampU8(s.HeartRate),
		})
	}
	return Ride{StartedAt: req.StartedAt, Samples: samples}, nil
}
