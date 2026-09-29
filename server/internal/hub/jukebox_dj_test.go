package hub

import (
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// reportEnd is every client's "ended" for whatever is on the deck, at the
// epoch the server holds — a video by its id, a library track by its own.
func reportEnd(j *jukebox, at time.Time) *playedTrack {
	cur := j.snapshot().Current
	if cur == nil {
		return nil
	}
	j.finished = nil
	accepted(j, protocol.JukeboxCommand{
		Action: "ended", VideoID: cur.VideoID, TrackID: cur.TrackID, AnchorMs: j.state.AnchorMs,
	}, "r-jan", "jan", at)
	return j.finished
}

// The dj trophy counts plays the server timed (#2931). Every tick carries the
// video id and the anchor, so any member could queue a track, report "ended"
// at once and repeat: fifty rounds at the command throttle earned `dj` with
// nothing played. The report still moves the deck on; the credit asks the
// server's own clock.
func TestAQueueAndEndLoopEarnsNoDJCredit(t *testing.T) {
	j := newJukebox()
	at := jat(0)
	for i := range 50 {
		add(j, "dQw4w9WgXcQ", at)
		at = at.Add(300 * time.Millisecond) // the jukebox throttle
		if credit := reportEnd(j, at); credit != nil {
			t.Fatalf("round %d: a track reported ended %v after it was queued earned %+v", i, 300*time.Millisecond, credit)
		}
		if j.snapshot().Current != nil {
			t.Fatalf("round %d: the report no longer moves the deck on", i)
		}
		at = at.Add(300 * time.Millisecond)
	}
}

func TestADJCreditNeedsAMinuteOfServerTimedPlay(t *testing.T) {
	const track = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
	tests := []struct {
		name string
		// run plays the deck from jat(0) and returns when the end is reported.
		run  func(j *jukebox) time.Time
		want bool
	}{
		{"a video played a minute", func(j *jukebox) time.Time {
			add(j, "dQw4w9WgXcQ", jat(0))
			return jat(60)
		}, true},
		{"a video a second short of a minute", func(j *jukebox) time.Time {
			add(j, "dQw4w9WgXcQ", jat(0))
			return jat(59)
		}, false},
		{"a pause is not play", func(j *jukebox) time.Time {
			add(j, "dQw4w9WgXcQ", jat(0))
			accepted(j, protocol.JukeboxCommand{Action: "pause"}, "r-jan", "jan", jat(30))
			accepted(j, protocol.JukeboxCommand{Action: "play"}, "r-jan", "jan", jat(600))
			return jat(620) // 30 s + 20 s of play across ten minutes
		}, false},
		{"play resumed after a pause adds up", func(j *jukebox) time.Time {
			add(j, "dQw4w9WgXcQ", jat(0))
			accepted(j, protocol.JukeboxCommand{Action: "pause"}, "r-jan", "jan", jat(30))
			accepted(j, protocol.JukeboxCommand{Action: "play"}, "r-jan", "jan", jat(600))
			return jat(630)
		}, true},
		{"a seek to the end is not play", func(j *jukebox) time.Time {
			add(j, "dQw4w9WgXcQ", jat(0))
			accepted(j, protocol.JukeboxCommand{Action: "seek", PositionSec: 3600}, "r-jan", "jan", jat(5))
			return jat(6)
		}, false},
		{"a library track played to its end", func(j *jukebox) time.Time {
			accepted(j, protocol.JukeboxCommand{Action: "add", TrackID: track, Title: "t", DurationMs: 180_000}, "r-jan", "jan", jat(0))
			return jat(178) // within the 5 s slack of its 3 minutes
		}, true},
		{"a library track ended a minute early", func(j *jukebox) time.Time {
			accepted(j, protocol.JukeboxCommand{Action: "add", TrackID: track, Title: "t", DurationMs: 180_000}, "r-jan", "jan", jat(0))
			return jat(120)
		}, false},
		{"a library track played a minute, then sought to its end", func(j *jukebox) time.Time {
			accepted(j, protocol.JukeboxCommand{Action: "add", TrackID: track, Title: "t", DurationMs: 600_000}, "r-jan", "jan", jat(0))
			accepted(j, protocol.JukeboxCommand{Action: "seek", PositionSec: 598}, "r-jan", "jan", jat(61))
			return jat(62)
		}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			j := newJukebox()
			credit := reportEnd(j, tt.run(j))
			if got := credit != nil; got != tt.want {
				t.Fatalf("credited = %v, want %v (%+v)", got, tt.want, credit)
			}
			if credit != nil && credit.riderID != "r-jan" {
				t.Fatalf("credited %q, want the rider who queued it", credit.riderID)
			}
			// Exactly one credit: every other client's echo of the same end
			// is a no-op.
			if echo := reportEnd(j, jat(700)); echo != nil {
				t.Fatalf("an echo of the same end credited again: %+v", echo)
			}
		})
	}
}
