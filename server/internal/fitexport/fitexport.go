// Package fitexport encodes a finished ride as a .fit Activity file.
//
// The message sequence follows what Garmin's Activity file profile requires and
// what Strava's uploader accepts: FileId, then Records in time order, then Lap,
// Session and Activity. Strava rejects files missing Session or Activity, and
// orders matter — Records must precede the Lap/Session that summarise them.
package fitexport

import (
	"bytes"
	"fmt"
	"math"
	"time"

	"github.com/muktihari/fit/decoder"
	"github.com/muktihari/fit/encoder"
	"github.com/muktihari/fit/profile/mesgdef"
	"github.com/muktihari/fit/profile/typedef"
	"github.com/muktihari/fit/proto"
)

// FIT fields are fixed-width, so every summary has to narrow. These clamps are
// unreachable for a real ride — an average cannot exceed its inputs, and uint32
// milliseconds is 49 days — but writing the bound out makes each conversion
// provably safe instead of assumed, and satisfies gosec's G115 without a nolint.
func narrowU8(v uint64) uint8 {
	if v > math.MaxUint8 {
		return math.MaxUint8
	}
	return uint8(v)
}

func narrowU16(v uint64) uint16 {
	if v > math.MaxUint16 {
		return math.MaxUint16
	}
	return uint16(v)
}

func narrowU32(v int64) uint32 {
	if v < 0 {
		return 0
	}
	if v > math.MaxUint32 {
		return math.MaxUint32
	}
	return uint32(v)
}

// Manufacturer/product are ours; Strava keys "virtual ride" off sub-sport, not these.
const (
	manufacturer = typedef.ManufacturerDevelopment
	productName  = "WattRoom"
)

// Sample is one second of a ride. Zero values mean "not measured": a rider with no
// HR strap sends HeartRate 0, and that field is then omitted rather than recorded
// as a real zero.
type Sample struct {
	// Offset from the ride start, seconds.
	Second    int
	Watts     uint16
	Cadence   uint8
	HeartRate uint8
}

// Ride is everything needed to produce an activity file.
//
// Deliberately no workout name: a FIT Activity file has nowhere sensible to put one
// (wkt_name belongs to Workout files, which importers ignore inside an activity).
// Strava takes the activity name as a parameter on POST /uploads instead, so naming
// belongs to the upload call in #34, not to this encoder.
type Ride struct {
	StartedAt time.Time
	Samples   []Sample
}

// Encode writes ride as a .fit Activity file.
func Encode(ride Ride) ([]byte, error) {
	if len(ride.Samples) == 0 {
		return nil, fmt.Errorf("fitexport: ride has no samples")
	}
	if ride.StartedAt.IsZero() {
		return nil, fmt.Errorf("fitexport: ride has no start time")
	}
	// Records must be chronological. Unordered input encodes without complaint and
	// produces a file importers reject, so fail here where the message is useful.
	for i, s := range ride.Samples {
		if s.Second < 0 {
			return nil, fmt.Errorf("fitexport: sample %d has negative offset %d", i, s.Second)
		}
		if i > 0 && s.Second <= ride.Samples[i-1].Second {
			return nil, fmt.Errorf(
				"fitexport: samples must be strictly increasing, sample %d has offset %d after %d",
				i, s.Second, ride.Samples[i-1].Second,
			)
		}
	}

	start := ride.StartedAt.UTC()

	fileID := mesgdef.NewFileId(nil).
		SetType(typedef.FileActivity).
		SetManufacturer(manufacturer).
		SetProduct(0).
		SetProductName(productName).
		SetTimeCreated(start).
		SetSerialNumber(0)

	records := make([]*mesgdef.Record, 0, len(ride.Samples))
	var (
		totalWatts uint64
		maxWatts   uint16
		maxCadence uint8
		maxHR      uint8
		hrSum      uint64
		hrCount    uint64
		cadSum     uint64
		cadCount   uint64
	)

	for _, s := range ride.Samples {
		record := mesgdef.NewRecord(nil).
			SetTimestamp(start.Add(time.Duration(s.Second) * time.Second)).
			SetPower(s.Watts)

		if s.Cadence > 0 {
			record.SetCadence(s.Cadence)
			cadSum += uint64(s.Cadence)
			cadCount++
			if s.Cadence > maxCadence {
				maxCadence = s.Cadence
			}
		}
		if s.HeartRate > 0 {
			record.SetHeartRate(s.HeartRate)
			hrSum += uint64(s.HeartRate)
			hrCount++
			if s.HeartRate > maxHR {
				maxHR = s.HeartRate
			}
		}

		totalWatts += uint64(s.Watts)
		if s.Watts > maxWatts {
			maxWatts = s.Watts
		}
		records = append(records, record)
	}

	elapsed := time.Duration(len(ride.Samples)) * time.Second
	elapsedMillis := narrowU32(elapsed.Milliseconds())
	avgWatts := narrowU16(totalWatts / uint64(len(ride.Samples)))
	// 1 kJ = 1 kcal closely enough for cycling at ~24 % efficiency; this is the
	// convention every head unit uses.
	kilojoules := narrowU16(totalWatts / 1000)

	lap := mesgdef.NewLap(nil).
		SetTimestamp(start.Add(elapsed)).
		SetStartTime(start).
		SetTotalElapsedTime(elapsedMillis).
		SetTotalTimerTime(elapsedMillis).
		SetSport(typedef.SportCycling).
		SetAvgPower(avgWatts).
		SetMaxPower(maxWatts).
		SetTotalCalories(kilojoules).
		SetEvent(typedef.EventLap).
		SetEventType(typedef.EventTypeStop)

	session := mesgdef.NewSession(nil).
		SetTimestamp(start.Add(elapsed)).
		SetStartTime(start).
		SetTotalElapsedTime(elapsedMillis).
		SetTotalTimerTime(elapsedMillis).
		SetSport(typedef.SportCycling).
		// Strava reads this to classify the activity as a VirtualRide.
		SetSubSport(typedef.SubSportVirtualActivity).
		SetAvgPower(avgWatts).
		SetMaxPower(maxWatts).
		SetTotalCalories(kilojoules).
		SetFirstLapIndex(0).
		SetNumLaps(1).
		SetEvent(typedef.EventSession).
		SetEventType(typedef.EventTypeStop)

	if cadCount > 0 {
		avg := narrowU8(cadSum / cadCount)
		lap.SetAvgCadence(avg).SetMaxCadence(maxCadence)
		session.SetAvgCadence(avg).SetMaxCadence(maxCadence)
	}
	if hrCount > 0 {
		avg := narrowU8(hrSum / hrCount)
		lap.SetAvgHeartRate(avg).SetMaxHeartRate(maxHR)
		session.SetAvgHeartRate(avg).SetMaxHeartRate(maxHR)
	}

	activityMesg := mesgdef.NewActivity(nil).
		SetTimestamp(start.Add(elapsed)).
		SetTotalTimerTime(elapsedMillis).
		SetNumSessions(1).
		SetType(typedef.ActivityManual).
		SetEvent(typedef.EventActivity).
		SetEventType(typedef.EventTypeStop)

	// Built by hand rather than via filedef.Activity.ToFIT, which emits Session before
	// Lap. The Activity file profile is ordered records -> laps -> session -> activity,
	// and that order is load-bearing for importers, so we own the sequence.
	fit := proto.FIT{Messages: make([]proto.Message, 0, len(records)+4)}
	fit.Messages = append(fit.Messages, fileID.ToMesg(nil))
	for _, record := range records {
		fit.Messages = append(fit.Messages, record.ToMesg(nil))
	}
	fit.Messages = append(fit.Messages,
		lap.ToMesg(nil),
		session.ToMesg(nil),
		activityMesg.ToMesg(nil),
	)

	var buf bytes.Buffer
	if err := encoder.New(&buf).Encode(&fit); err != nil {
		return nil, fmt.Errorf("fitexport: encode: %w", err)
	}
	return buf.Bytes(), nil
}

// MessageKinds lists the message numbers in the encoded file, in order. Tests assert
// on this rather than only on bytes: a library upgrade that reorders or drops a
// message would otherwise still produce a plausible file that Strava rejects.
func MessageKinds(data []byte) ([]typedef.MesgNum, error) {
	fit, err := decoder.New(bytes.NewReader(data)).Decode()
	if err != nil {
		return nil, fmt.Errorf("fitexport: decode: %w", err)
	}
	kinds := make([]typedef.MesgNum, 0, len(fit.Messages))
	for _, m := range fit.Messages {
		kinds = append(kinds, m.Num)
	}
	return kinds, nil
}
