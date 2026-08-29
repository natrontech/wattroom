package fitexport

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/muktihari/fit/decoder"
	"github.com/muktihari/fit/profile/filedef"
	"github.com/muktihari/fit/profile/typedef"
)

var update = os.Getenv("UPDATE_GOLDEN") == "1"

// fixture is deliberately small and deterministic: a two-minute ride with a warmup
// that has no heart rate yet, so the "omit unmeasured fields" path is exercised.
func fixture() Ride {
	samples := make([]Sample, 0, 120)
	for i := range 120 {
		s := Sample{Second: i, Watts: uint16(150 + i), Cadence: uint8(85 + i%5)}
		if i >= 30 {
			s.HeartRate = uint8(120 + i/10)
		}
		samples = append(samples, s)
	}
	return Ride{
		StartedAt: time.Date(2026, 8, 29, 6, 0, 0, 0, time.UTC),

		Samples: samples,
	}
}

func TestEncodeRejectsUnusableRides(t *testing.T) {
	tests := map[string]Ride{
		"no samples":    {StartedAt: time.Now()},
		"no start time": {Samples: []Sample{{Second: 0, Watts: 200}}},
		// FIT requires chronological records; unordered input would otherwise encode
		// cleanly and be rejected by whatever imports it.
		"out of order": {
			StartedAt: time.Now(),
			Samples:   []Sample{{Second: 0, Watts: 200}, {Second: 5, Watts: 200}, {Second: 3, Watts: 200}},
		},
		"duplicate offsets": {
			StartedAt: time.Now(),
			Samples:   []Sample{{Second: 0, Watts: 200}, {Second: 0, Watts: 210}},
		},
		"negative offset": {
			StartedAt: time.Now(),
			Samples:   []Sample{{Second: -1, Watts: 200}},
		},
	}
	for name, ride := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := Encode(ride); err == nil {
				t.Fatal("want error, got nil")
			}
		})
	}
}

// TestEncodeMessageOrder is the test that matters. Strava rejects an activity file
// missing Session or Activity, and Records must precede the Lap and Session that
// summarise them. Asserting on order catches a library upgrade that reshuffles
// messages while still producing a superficially valid file.
func TestEncodeMessageOrder(t *testing.T) {
	data, err := Encode(fixture())
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}

	kinds, err := MessageKinds(data)
	if err != nil {
		t.Fatalf("MessageKinds: %v", err)
	}

	if len(kinds) == 0 || kinds[0] != typedef.MesgNumFileId {
		t.Fatalf("want FileId first, got %v", kinds[:min(3, len(kinds))])
	}

	indexOf := func(want typedef.MesgNum) int {
		for i, k := range kinds {
			if k == want {
				return i
			}
		}
		return -1
	}

	lastRecord := -1
	for i, k := range kinds {
		if k == typedef.MesgNumRecord {
			lastRecord = i
		}
	}
	lap, session, activity := indexOf(typedef.MesgNumLap), indexOf(typedef.MesgNumSession), indexOf(typedef.MesgNumActivity)

	switch {
	case lastRecord == -1:
		t.Fatal("no Record messages")
	case lap == -1:
		t.Fatal("no Lap message — Strava rejects the file")
	case session == -1:
		t.Fatal("no Session message — Strava rejects the file")
	case activity == -1:
		t.Fatal("no Activity message — Strava rejects the file")
	case lap < lastRecord:
		t.Errorf("Lap at %d precedes last Record at %d", lap, lastRecord)
	case session < lap:
		t.Errorf("Session at %d precedes Lap at %d", session, lap)
	case activity < session:
		t.Errorf("Activity at %d precedes Session at %d", activity, session)
	}
}

func TestEncodeSummariesMatchSamples(t *testing.T) {
	ride := fixture()
	data, err := Encode(ride)
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}

	fit, err := decoder.New(bytes.NewReader(data)).Decode()
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	activity := filedef.NewActivity(fit.Messages...)

	if got, want := len(activity.Records), len(ride.Samples); got != want {
		t.Errorf("records = %d, want %d", got, want)
	}
	if len(activity.Sessions) != 1 {
		t.Fatalf("sessions = %d, want 1", len(activity.Sessions))
	}

	session := activity.Sessions[0]
	if got := session.SubSport; got != typedef.SubSportVirtualActivity {
		t.Errorf("sub-sport = %v, want VirtualActivity — Strava classifies the ride from this", got)
	}
	if got := session.Sport; got != typedef.SportCycling {
		t.Errorf("sport = %v, want Cycling", got)
	}

	// 150..269 inclusive sums to 25140 over 120 samples = 209.5, which rounds to 210.
	// Strava computes 210 from the records; a truncating average would report 209.
	if got, want := session.AvgPower, uint16(210); got != want {
		t.Errorf("avg power = %d, want %d", got, want)
	}
	if got, want := session.MaxPower, uint16(269); got != want {
		t.Errorf("max power = %d, want %d", got, want)
	}
	if got, want := session.TotalElapsedTime, uint32(120_000); got != want {
		t.Errorf("elapsed = %d ms, want %d", got, want)
	}
}

// TestEncodeOmitsUnmeasuredFields: a rider with no HR strap must not get a file full
// of zero-bpm records, which read as a real measurement to anything importing it.
func TestEncodeOmitsUnmeasuredFields(t *testing.T) {
	ride := Ride{
		StartedAt: time.Date(2026, 8, 29, 6, 0, 0, 0, time.UTC),
		Samples:   []Sample{{Second: 0, Watts: 200}, {Second: 1, Watts: 205}},
	}
	data, err := Encode(ride)
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	fit, err := decoder.New(bytes.NewReader(data)).Decode()
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	for i, record := range filedef.NewActivity(fit.Messages...).Records {
		if record.HeartRate != basetypeUint8Invalid {
			t.Errorf("record %d has heart rate %d, want it absent", i, record.HeartRate)
		}
	}
}

// TestGoldenFile pins the bytes. Regenerate deliberately with UPDATE_GOLDEN=1.
func TestGoldenFile(t *testing.T) {
	data, err := Encode(fixture())
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	path := filepath.Join("testdata", "ride.fit")

	if update {
		if err := os.MkdirAll("testdata", 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
		t.Log("golden file updated")
		return
	}

	want, err := os.ReadFile(path) //nolint:gosec // fixed path built from literals in this test
	if err != nil {
		t.Fatalf("read golden (regenerate with UPDATE_GOLDEN=1): %v", err)
	}
	if !bytes.Equal(data, want) {
		t.Errorf("encoded output differs from golden file (%d vs %d bytes)", len(data), len(want))
	}
}

const basetypeUint8Invalid = 0xFF
