// The room's side of the jukebox: a command from a rider, through the
// permission gate, into the deck — and autoplay's pick when the queue runs dry.
package hub

import (
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// jukebox runs one deck command and hands back the track it finished, if
// this command was the one that ended it (#467) — for the caller to credit
// outside the lock. A command that ran the deck dry hands the room to
// autoplay (#676), also outside the lock: the trigger takes it again.
func (rm *room) jukebox(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) (*playedTrack, bool) {
	played, ok, _ := rm.jukeboxWithRefusal(cmd, riderID, addedBy, now)
	return played, ok
}

func (rm *room) jukeboxWithRefusal(cmd protocol.JukeboxCommand, riderID, addedBy string, now time.Time) (*playedTrack, bool, jukeboxRefusal) {
	rm.mu.Lock()
	events, ok, refusal := rm.music.applyWithRefusal(cmd, riderID, addedBy, now)
	for _, ev := range events {
		rm.events.add(ev, now)
	}
	played := rm.music.finished
	rm.music.finished = nil
	ev := rm.music.event
	rm.music.event = nil
	idled := rm.music.idled
	rm.music.idled = false
	rm.mu.Unlock()
	if ev != nil && rm.deckPlayed != nil {
		rm.deckPlayed(*ev)
	}
	if idled && rm.deckIdled != nil {
		rm.deckIdled()
	}
	return played, ok, refusal
}

// applyAutoplay seeds the queue from what triggerAutoplay's DB read found
// (#627). Re-checks idle under the lock: the read ran outside it, so a
// manual add — or another join's own trigger racing this one — may have
// already filled the deck by the time this runs, and the last one to the
// lock backs off rather than doubling the queue.
func (rm *room) applyAutoplay(fixed *protocol.JukeboxCommand, tracks []protocol.JukeboxCommand, ok bool, now time.Time) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if !ok || rm.music.state.Current != nil {
		return
	}
	cmds := tracks
	if fixed != nil {
		cmds = append([]protocol.JukeboxCommand{*fixed}, tracks...)
	}
	for _, cmd := range cmds {
		events, added := rm.music.apply(cmd, "", autoplayActor, now)
		if !added {
			break
		}
		for _, ev := range events {
			rm.events.add(ev, now)
		}
	}
}
