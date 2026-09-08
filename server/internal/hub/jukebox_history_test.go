package hub

import (
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// The deck's half of #269: what leaves it, and whether that was a play or a
// skip. Nothing downstream can tell the difference if this is wrong — a skip
// recorded as a play makes smart shuffle prefer the track the room keeps
// rejecting, and it does that silently, forever.
func TestDeckReportsWhatHappenedToAPoolTrack(t *testing.T) {
	const otherTrack = "11111111-2222-3333-4444-555555555555"

	cases := []struct {
		name string
		// what is on the deck when the command lands
		queue func(j *jukebox)
		// the command that takes it off
		end func(j *jukebox) protocol.JukeboxCommand

		wantEvent   bool
		wantSkipped bool
		wantQueued  string
	}{
		{
			name:      "played through",
			queue:     func(j *jukebox) { addTrack(j, poolTrack, jat(0)) },
			end:       endedCmd,
			wantEvent: true, wantQueued: "r-jan",
		},
		{
			name:      "skipped past",
			queue:     func(j *jukebox) { addTrack(j, poolTrack, jat(0)) },
			end:       func(*jukebox) protocol.JukeboxCommand { return protocol.JukeboxCommand{Action: "skip"} },
			wantEvent: true, wantSkipped: true, wantQueued: "r-jan",
		},
		{
			// Autoplay queues with no rider id (#676): nobody's taste, so
			// the credit column stays empty rather than naming a listener.
			name: "queued by autoplay",
			queue: func(j *jukebox) {
				j.apply(protocol.JukeboxCommand{Action: "add", TrackID: poolTrack, Title: "Sandstorm"}, "", autoplayActor, jat(0))
			},
			end:       endedCmd,
			wantEvent: true, wantQueued: "",
		},
		{
			// A YouTube entry is not pool history: it has no row in `tracks`
			// to weight, and recording it would insert against a uuid that
			// does not exist.
			name:      "a video ending is not pool history",
			queue:     func(j *jukebox) { add(j, "dQw4w9WgXcQ", jat(0)) },
			end:       endedCmd,
			wantEvent: false,
		},
		{
			name:      "a video skipped is not pool history",
			queue:     func(j *jukebox) { add(j, "dQw4w9WgXcQ", jat(0)) },
			end:       func(*jukebox) protocol.JukeboxCommand { return protocol.JukeboxCommand{Action: "skip"} },
			wantEvent: false,
		},
		{
			// The stale-client end #1080 already refuses: it must not record
			// either, or a track nobody finished counts as played.
			name:  "another track's end records nothing",
			queue: func(j *jukebox) { addTrack(j, poolTrack, jat(0)) },
			end: func(j *jukebox) protocol.JukeboxCommand {
				return protocol.JukeboxCommand{Action: "ended", TrackID: otherTrack, AnchorMs: j.snapshot().AnchorMs}
			},
			wantEvent: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			j := newJukebox()
			tc.queue(j)
			if j.event != nil {
				t.Fatalf("queueing alone reported %+v — only leaving the deck is history", j.event)
			}
			j.apply(tc.end(j), "r-kim", "kim", jat(5))

			if !tc.wantEvent {
				if j.event != nil {
					t.Fatalf("recorded %+v, wanted nothing", j.event)
				}
				return
			}
			if j.event == nil {
				t.Fatal("nothing recorded")
			}
			if j.event.trackID != poolTrack {
				t.Errorf("track = %q, want %q", j.event.trackID, poolTrack)
			}
			if j.event.skipped != tc.wantSkipped {
				t.Errorf("skipped = %v, want %v", j.event.skipped, tc.wantSkipped)
			}
			// Who QUEUED it, not who pressed skip — "r-kim" is the actor on
			// every command above, and must never end up here.
			if j.event.queuedBy != tc.wantQueued {
				t.Errorf("queuedBy = %q, want %q", j.event.queuedBy, tc.wantQueued)
			}
		})
	}
}

func endedCmd(j *jukebox) protocol.JukeboxCommand {
	cur := j.snapshot()
	return protocol.JukeboxCommand{
		Action: "ended", VideoID: cur.Current.VideoID, TrackID: cur.Current.TrackID, AnchorMs: cur.AnchorMs,
	}
}

// The room drains the event exactly once: a second command must not re-report
// the track that ended before it, which would double every play in the
// history and quietly bias the weighting toward whatever gets played first.
func TestTheRoomDrainsEachDeckEventOnce(t *testing.T) {
	rm := newRoom("history-room")
	var seen []trackEvent
	rm.deckPlayed = func(ev trackEvent) { seen = append(seen, ev) }

	rm.jukebox(protocol.JukeboxCommand{Action: "add", TrackID: poolTrack, Title: "Sandstorm"}, "r-jan", "jan", jat(0))
	rm.jukebox(protocol.JukeboxCommand{Action: "add", VideoID: "dQw4w9WgXcQ", Title: "next"}, "r-jan", "jan", jat(1))
	rm.jukebox(protocol.JukeboxCommand{Action: "skip"}, "r-kim", "kim", jat(2))
	// A no-op command after it: the deck holds a video now, and the pool
	// track is already spent.
	rm.jukebox(protocol.JukeboxCommand{Action: "play"}, "r-kim", "kim", jat(3))

	if len(seen) != 1 {
		t.Fatalf("recorded %d events, want 1: %+v", len(seen), seen)
	}
	if seen[0].trackID != poolTrack || !seen[0].skipped {
		t.Errorf("wrong event: %+v", seen[0])
	}
}
