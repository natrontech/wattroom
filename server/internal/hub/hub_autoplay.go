package hub

// Autoplay: what a voice channel's deck plays when nobody queued anything,
// read off the thread that owns the database, never the tick. Split from
// hub.go (#3357).

import (
	"context"
	"time"

	"github.com/natrontech/wattroom/server/internal/jobmetrics"
	"github.com/natrontech/wattroom/server/internal/protocol"
)

// AutoplaySource answers what a room's autoplay should draw from (#627),
// read once per trigger — a rider joining an idle deck, or the deck running
// dry (#676) — and always outside the room's lock (server/AGENTS.md: DB I/O
// never happens while holding a room mutex). Defined here, where it is
// consumed; the playlists service implements it. Nil, or ok=false, means
// nothing to play: autoplay stays silent. tracks already carries whatever
// order (list order or shuffled) the caller's autoplay setting currently
// means. mood is what the room's timeline is asking for at the moment of the
// read (#270); the zero value means no preference, and every source is free
// to ignore it.
type AutoplaySource interface {
	Autoplay(ctx context.Context, channel string, mood SessionMood) (tracks []protocol.JukeboxCommand, ok bool)
}

// TrackHistory hears what a room did with a pool track (#269, ADR-0015):
// played it through, or skipped past it. Defined here, where it is consumed;
// the playlists service implements it. Nil means no history is kept, and
// smart shuffle degrades to a plain random draw — which is exactly what an
// empty history already weights to.
//
// Called outside every room lock, from the goroutine that ran the deck
// command, and BEFORE the same command's autoplay refill: the implementation
// may block briefly on its own write, and should, or the track that just
// ended is not yet in the history the refill weights against.
type TrackHistory interface {
	TrackEnded(ctx context.Context, channel string, play Play)
	// Recent is the room's "just played" as the log remembers it (#1432),
	// newest first, at most n — what a room the hub has just created shows
	// until it plays something of its own. Called from the autoplay worker,
	// outside every lock.
	Recent(ctx context.Context, channel string, n int) []protocol.JukeboxEntry
}

// Play is one thing a deck finished with (#269, #1432): a library track by
// id, or a video by its YouTube id and the title the deck showed. QueuedBy
// is who queued it — empty for autoplay — and Skipped says whether the room
// let it end or pushed past it.
type Play struct {
	TrackID  string
	VideoID  string
	Title    string
	QueuedBy string
	Skipped  bool
}

// autoplayJob is one idle deck worth checking — enough to read the room's
// autoplay plan and hand it back to the room that asked.
type autoplayJob struct {
	rm      *channelState
	channel string
	// A room the hub just created (#1432): read its "just played" from the
	// log instead of an autoplay plan.
	seed bool
}

// SetPlaylistSource wires autoplay's read side in (#627), like SetXpKeeper.
// Nil stays valid — autoplay just never fires.
func (h *Hub) SetPlaylistSource(k AutoplaySource) { h.playlists = k }

// SetTrackHistory wires the play/skip log smart shuffle reads (#269) — like
// every other keeper, before the first room exists.
func (h *Hub) SetTrackHistory(k TrackHistory) { h.history = k }

// autoplayWorker drains the autoplay-trigger queue (#627): a stalled
// database backs up this queue, never a joining rider's upgrade or any tick.
// Exits when the process does — the hub has no shutdown, it lives as long as
// the server.
// ponytail: one worker for the whole hub; per-channel workers if a slow read
// ever lets one loud channel starve the rest.
func (h *Hub) autoplayWorker() {
	for job := range h.autoplays {
		if job.seed {
			if h.history != nil {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				entries := h.history.Recent(ctx, job.channel, maxHistory)
				cancel()
				job.rm.mu.Lock()
				job.rm.music.seedHistory(entries)
				job.rm.mu.Unlock()
			}
			continue
		}
		// Read the mood at the moment of the REFILL, not when the job was
		// queued: the worker can lag a busy hub, and a block that has since
		// ended is not what the room is riding.
		//
		// Bounded (#2874): this one worker serves every channel, so a read
		// that hung would stall autoplay everywhere while the queue filled.
		ctx, cancel := context.WithTimeout(context.Background(), autoplayBudget)
		tracks, ok := h.playlists.Autoplay(ctx, job.channel, job.rm.mood(h.now()))
		jobmetrics.Ran(autoplayJobName, ctx.Err())
		cancel()
		job.rm.applyAutoplay(tracks, ok, h.now())
	}
}

// autoplayBudget bounds one autoplay read: a channel's settings and one
// playlist's tracks, or smart shuffle's history — gamify's jobBudget shape.
const autoplayBudget = 5 * time.Second

// autoplayJobName is the worker's name to the operator's metrics
// (jobmetrics): its runs, the reads that timed out, the jobs a full queue
// dropped.
const autoplayJobName = "hub autoplay"

// recordTrackEvent logs one pool track the deck finished with (#269). The
// deck has already moved on, so nothing is waiting on this — but it runs
// before the refill that reads it back, which is why it is not fired into a
// goroutine. The timeout bounds a rider's WS read loop; a history line lost
// to a slow database costs one nudge in a weighting, so it is logged and
// dropped rather than retried.
func (h *Hub) recordTrackEvent(channel string, ev trackEvent) {
	if h.history == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	h.history.TrackEnded(ctx, channel, Play{
		TrackID: ev.trackID, VideoID: ev.videoID, Title: ev.title,
		QueuedBy: ev.queuedBy, Skipped: ev.skipped,
	})
}

// triggerAutoplay checks a room's deck and, if it is idle, enqueues the DB
// read that decides what autoplay puts on it (#627). Fired by a join and by
// the deck running dry (#676). The check-then-enqueue happens
// outside any I/O; the worker re-checks idle under the room's lock before
// seeding, so two riders joining the same instant cannot double-queue the
// room's playlist. Nothing here re-fires itself: a loop needs a real "ended"
// from a client each pass, and a source with nothing to play — autoplay off,
// an empty playlist — leaves the deck idle and the queue quiet.
func (h *Hub) triggerAutoplay(rm *channelState, channel string) {
	if h.playlists == nil {
		return
	}
	rm.mu.Lock()
	idle := rm.music.state.Current == nil
	rm.mu.Unlock()
	if !idle {
		return
	}
	select {
	case h.autoplays <- autoplayJob{rm: rm, channel: channel}:
	default:
		// Full queue: the room just stays idle until the next join, which
		// will try again — better than a joining rider's upgrade or read
		// loop blocking.
		h.log.Warn("autoplay queue full, skipping", "channel", channel)
		jobmetrics.Dropped(autoplayJobName)
	}
}

// QueuePlaylist appends a saved playlist's tracks onto a room's live queue
// (#627) — a rider pressed "queue" from the playlists panel, which is a plain
// plain HTTP call, not a WS command. Returns false when nobody is
// connected to seed a deck for; the caller (who is presumably looking at
// this room's jukebox right now) should not normally see that. addedCount is
// how many tracks actually landed, for the response — the queue's own caps
// (jukebox.go's maxQueue/maxQueuedTracks) can stop it short.
func (h *Hub) QueuePlaylist(channel, riderID, addedBy string, tracks []protocol.JukeboxCommand) (addedCount int, ok bool) {
	rm := h.occupied(channel)
	if rm == nil {
		return 0, false
	}
	now := h.now()
	for _, cmd := range tracks {
		if _, added := rm.jukebox(cmd, riderID, addedBy, now); !added {
			break // cap hit or a bad entry slipped through — stop, don't skip holes
		}
		addedCount++
	}
	return addedCount, true
}
