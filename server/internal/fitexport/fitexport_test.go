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
		s := Sample{Second: i, Watts: uint16(150 + i), Cadence: uint8(85 + i%5)} //nolint:gosec // i < 120, comfortably inside both types
		if i >= 30 {
			s.HeartRate = uint8(120 + i/10) //nolint:gosec // i < 120 → hr < 132
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

// #1140. Records are stamped from each sample's own offset; both durations
// used to come from len(Samples). Two samples ten seconds apart wrote records
// up to start+10 and a session that ended at start+2 — a summary
// contradicting its own records, in a file that decodes and CRCs cleanly.
//
// Reachable through the stateless export (`http.go`), which takes the
// client's offsets and only checks they are non-negative and increasing. The
// three callers in this repo all number samples `Second: i`, so this is about
// what that endpoint's own client can send, and every dense export is
// unchanged.
func TestSparseOffsetsKeepTheSummaryAroundTheRecords(t *testing.T) {
	start := time.Date(2026, 9, 8, 6, 0, 0, 0, time.UTC)
	ride := Ride{
		StartedAt: start,
		Samples: []Sample{
			{Second: 0, Watts: 200},
			{Second: 10, Watts: 220},
			{Second: 30, Watts: 240},
		},
	}
	data, err := Encode(ride)
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	fit, err := decoder.New(bytes.NewReader(data)).Decode()
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	activity := filedef.NewActivity(fit.Messages...)
	session := activity.Sessions[0]

	// Wall clock: ride start to the end of the last record, 30 s + the second
	// that record covers.
	if got, want := session.TotalElapsedTime, uint32(31_000); got != want {
		t.Errorf("elapsed = %d ms, want %d — the summary must reach the last record", got, want)
	}
	// Recording time: three samples, three seconds. A gap is the absence of
	// samples, which is stored data — not a pause we invented.
	if got, want := session.TotalTimerTime, uint32(3_000); got != want {
		t.Errorf("timer = %d ms, want %d — only the seconds actually recorded", got, want)
	}
	// The bound that was actually broken: no record may sit past the summary.
	last := activity.Records[len(activity.Records)-1].Timestamp
	if end := session.StartTime.Add(time.Duration(session.TotalElapsedTime) * time.Millisecond); last.After(end) {
		t.Errorf("last record at %v is past the session end %v", last, end)
	}
	if len(activity.Records) != len(ride.Samples) {
		t.Errorf("records = %d, want %d", len(activity.Records), len(ride.Samples))
	}
}

// A ride whose first sample is not at zero: the rider's own start time is
// still when the ride started, so elapsed is measured from it rather than
// from the first thing that happened to be recorded.
func TestANonZeroFirstOffsetIsMeasuredFromTheRideStart(t *testing.T) {
	start := time.Date(2026, 9, 8, 6, 0, 0, 0, time.UTC)
	data, err := Encode(Ride{
		StartedAt: start,
		Samples:   []Sample{{Second: 5, Watts: 200}, {Second: 6, Watts: 210}},
	})
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	fit, err := decoder.New(bytes.NewReader(data)).Decode()
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	session := filedef.NewActivity(fit.Messages...).Sessions[0]
	if got, want := session.TotalElapsedTime, uint32(7_000); got != want {
		t.Errorf("elapsed = %d ms, want %d", got, want)
	}
	if got, want := session.TotalTimerTime, uint32(2_000); got != want {
		t.Errorf("timer = %d ms, want %d", got, want)
	}
}

// The continuous ride every durable path actually produces: the two durations
// agree, and the file is what it was before #1140.
func TestAContinuousRideHasOneDuration(t *testing.T) {
	data, err := Encode(fixture())
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	fit, err := decoder.New(bytes.NewReader(data)).Decode()
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	session := filedef.NewActivity(fit.Messages...).Sessions[0]
	if session.TotalElapsedTime != session.TotalTimerTime {
		t.Errorf("elapsed %d != timer %d on a ride with no gaps",
			session.TotalElapsedTime, session.TotalTimerTime)
	}
	if got, want := session.TotalTimerTime, uint32(120_000); got != want {
		t.Errorf("timer = %d ms, want %d", got, want)
	}
}
