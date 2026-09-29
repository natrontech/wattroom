// The room's goroutine: one per live room, one tick a second. Every mutation
// the room makes arrives on its channels and is applied here, which is what
// makes the room's fields safe to touch without each caller taking a lock.
package hub

import (
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

const tickInterval = time.Second

// bestScreen is whether this socket describes its rider better than the one
// held so far (#2131). A measured round trip beats none — a socket in its
// first few seconds has not been pinged yet, and it must not silence a
// sibling that has — and between two measured sockets the quicker wins.
//
// Chosen once per rider per tick so the roster's ping and device word come
// from the same connection: a rider's laptop and their phone are two screens
// and the roster has one row.
func bestScreen(candidate, held *client) bool {
	mine, theirs := candidate.ping(), held.ping()
	if mine == 0 || theirs == 0 {
		return theirs == 0 && mine > 0
	}
	return mine < theirs
}

// run broadcasts one tick per interval while anyone is connected. The tick
// always carries the session state and roster — the timer must advance on
// screens even when nobody is pedalling yet.
// The ticker runs on while the room is empty — this clock is the only thing
// that will close and save a session whose last rider shut the tab — and the
// room is let go of entirely once it has been empty, quiet and between
// sessions for channelIdleTTL (forget.go).
func (rm *channelState) run(log *slog.Logger, now func() time.Time, saver SessionSaver) {
	// A timer, not a ticker: the interval bursts to 4 Hz while a sprint window
	// is live (SPEC) and returns to 1 Hz after.
	timer := time.NewTimer(tickInterval)
	defer timer.Stop()
	// The lock below is taken by hand and released twice per iteration, so a
	// panic inside the tick would unwind holding it — and the relaunch
	// Supervise does (#738) would then park on Lock() for good: a room that
	// never ticks again, and every hub-wide walk over rooms (WhereIs,
	// Presence) hung behind it. Release it on the way out instead.
	locked := false
	defer func() {
		if locked {
			rm.mu.Unlock()
		}
	}()
	// Presence push (#251): phase and the riding set are the live signals the
	// rail shows for rooms you are NOT in — ping the lobby only when one of
	// them changes between ticks, never per tick.
	var last tickMemory
	lastTick := now()
	for {
		select {
		case <-rm.stop:
			// The room was deleted: no tick, and no session save. The
			// channel's delete refuses while a session is open (#2816), so
			// there is none here to lose.
			return
		case <-timer.C:
		}
		rm.mu.Lock()
		locked = true
		// Wall time since the previous tick — the voice clock's step, which a
		// sprint's 4 Hz burst must not quadruple.
		dt := now().Sub(lastTick)
		lastTick = now()
		timer.Reset(rm.tickIntervalLocked(now()))
		if len(rm.clients) == 0 {
			ended, idleFor := rm.tickEmptyLocked(now, saver != nil)
			locked = false
			rm.mu.Unlock()
			rm.handOff(log, now, saver, ended)
			// Nothing left to do, and nobody to do it for (#2297): the hub
			// drops the room and this goroutine ends. Only the hub can say
			// so — a socket may be arriving that this tick cannot see — and
			// the next join builds a fresh room (ADR-0052's re-form path).
			if idleFor >= channelIdleTTL && rm.forget != nil && rm.forget() {
				logger(log).Info("room forgotten", "channel", rm.channel, "idle", idleFor)
				return
			}
			continue
		}
		out := rm.tickLocked(now, dt, saver != nil)
		locked = false
		rm.mu.Unlock()
		rm.announceTick(log, now, saver, &out, &last)
		rm.sendTick(log, &out)
	}
}

// tickMemory is what one tick remembers of the last, to ping the lobby only
// when the phase or the riding set changed (#251).
type tickMemory struct {
	phase, riding string
	riders        []string
}

// tickOut is one tick as its locked half built it, for the half that runs
// after rm.mu is released: telling the lobby and the XP keeper, and sending
// every socket its frame.
type tickOut struct {
	tick         protocol.ServerTick
	cheerFrom    []string
	rode         map[string]struct{}
	ended        *sessionEnd
	clients      []*client
	ridingKey    string
	ridingIDs    []string
	pairing      map[*client]protocol.SensorPairing
	pokes        map[*client][]protocol.Poke
	gameWinner   string
	sprintWinner string
}

// tickEmptyLocked is a tick with nobody in the channel: the clock still
// closes a session and says what happened, and says how long the room has
// been idle for the hub to let go of it. Caller holds rm.mu.
func (rm *channelState) tickEmptyLocked(now func() time.Time, saving bool) (*sessionEnd, time.Duration) {
	rm.endAbandonedGameLocked(now())
	rm.endAbandonedSessionLocked(now())
	// Nobody to tick to, but the clock still runs (audit 2026-09-09):
	// a session whose last rider closed the tab at minute 58 ends at
	// 60 and saves then, dated right — not on the next visit.
	state := rm.session.state(now())
	// And the bunch rides on with nobody watching: the plan still sets
	// its pace, so the first rider back finds it where the plan put it.
	rm.session.rideBunch(now())
	// Said now, at the moment it happened: skipping the line here
	// left phaseSaid at "running", and the next visitor watched the
	// session "end" live, hours late (audit 2026-09-09).
	rm.sayPhaseLocked(state, now())
	// The departures too, for the same reason (#2230). Skipped here,
	// the last riders stay parked in `departed` — so the room's
	// timeline loses the "left" line, and the first rider back hours
	// later is read as a flap and loses their "joined" one as well.
	// Silence in both directions, which is the opposite of what the
	// 15 s grace was for (#984).
	rm.sayDepartedLocked(now())
	ended := rm.closeLocked(state, now(), saving)
	// Resolved here, after the close above: a session that has just
	// crossed to done releases the room from this tick on, and one
	// still running holds it however empty the room is (forget.go).
	idleFor := rm.idleForLocked(state, now())
	return ended, idleFor
}

// tickLocked advances the channel one tick and builds what it sends. Caller
// holds rm.mu; nothing here does I/O.
func (rm *channelState) tickLocked(now func() time.Time, dt time.Duration, saving bool) tickOut {
	// Somebody is here: the idle window starts over when they go.
	rm.emptySince = time.Time{}
	rm.abandonedSince = time.Time{}
	gameWinner := rm.advanceGameLocked(now())
	// Resolved before the drain so a transition's own line rides the tick
	// that carries the transition, not the one after it.
	state := rm.session.state(now())
	// After state() has promoted a finished countdown: mood() never
	// advances anything, and running is the only phase with a block.
	state.TargetRpm = rm.session.mood(now()).TargetRPM()
	rm.session.rideBunch(now())
	rm.settleRoadsideLocked()
	rm.sayPhaseLocked(state, now())
	// Whoever has been gone longer than the grace window (#984). The tick
	// is the room's only clock, and the line has to be resolved before the
	// drain below or it waits a whole second for the next one.
	rm.sayDepartedLocked(now())
	rm.accrueVoiceLocked(state.Phase, dt)
	// Before the sprint is rendered, so a block's window rides the tick
	// that entered it rather than the one after.
	rm.armWorkoutSprintLocked(now())
	rm.armKomLocked(now())
	sprintNow, sprintWinner := rm.scoreSprintLocked(now())
	eventsNow := rm.events.drain()
	tick := protocol.ServerTick{
		At:         now().UnixMilli(),
		State:      state,
		Jukebox:    new(rm.music.snapshot()),
		JukeboxRev: rm.music.rev,
		Cheers:     rm.cheers,
		Board:      rm.board,
		Events:     eventsNow,
		Sprint:     sprintNow,
		Game:       rm.lastGame,
		Execution: func() map[string]float64 {
			out := make(map[string]float64, len(rm.seen))
			for id := range rm.seen {
				if score, scored := rm.record.execution(id); scored {
					out[id] = score
				}
			}
			return out
		}(),
		Voice:    rm.voiceIDsLocked(),
		World:    rm.session.world(rm.lastGame != nil && rm.lastGame.MeterHidden),
		Roadside: rm.session.roadside(),
		Riders:   rm.metrics,
		Roster:   make([]protocol.Rider, 0, len(rm.clients)),
	}
	rm.metrics = make(map[string]protocol.RiderMetrics)
	cheerFrom := rm.cheerFrom
	rm.cheers, rm.cheerFrom = nil, nil
	rm.board = nil
	// Who the session has seen, sampled once a second while the timeline
	// runs (ADR-0034). Cheap, and it needs no join/leave hook: the roster
	// is right here, already folded across a rider's several screens.
	//
	// The countdown is not the session (#1539): a coach who starts and
	// cancels inside the ten seconds rode nothing, and both docs/SPEC.md
	// and ADR-0034 say a session that never started leaves nothing. An
	// empty presence map is how closeLocked hears that, so this gate is
	// the whole of it — and it is what `countdown` already means to the
	// rest of the timeline, which mood() and sprintBlockAt() both refuse.
	if tick.State.Phase == "running" || tick.State.Phase == "paused" {
		rm.sawLocked(now())
	}
	// Once it has closed, the scores go only to the session's riders
	// (#2819) — nil while it runs, when the channel watches it live, and
	// when there is nothing to score, so everyone shares one frame.
	var rode map[string]struct{}
	if tick.State.Phase != "running" && tick.State.Phase != "paused" && len(tick.Execution) > 0 {
		rode = make(map[string]struct{}, len(rm.seen))
		for id := range rm.seen {
			rode[id] = struct{}{}
		}
	}
	// The session just closed: hand the ride record to the saver exactly
	// once. Snapshot under the lock, persist outside it (hub discipline:
	// no I/O while holding a room mutex).
	ended := rm.closeLocked(tick.State, now(), saving)
	// The stored row, on the first tick after the write came back.
	tick.Recap = rm.recap
	rm.recap = nil
	clients, ridingKey, ridingIDs := rm.rosterLocked(&tick, now)
	// Claim answers ride out with this tick but not IN it (#610): a
	// rider's device inventory is theirs, and the tick goes to the room.
	pairing := rm.drainPairingLocked()
	pokes := rm.drainPokesLocked()
	return tickOut{
		tick: tick, cheerFrom: cheerFrom, rode: rode, ended: ended, clients: clients,
		ridingKey: ridingKey, ridingIDs: ridingIDs, pairing: pairing, pokes: pokes,
		gameWinner: gameWinner, sprintWinner: sprintWinner,
	}
}

// rosterLocked fills the tick's roster — one entry per rider, however many
// sockets they hold — and hands back every socket, and who is riding. Caller
// holds rm.mu.
func (rm *channelState) rosterLocked(tick *protocol.ServerTick, now func() time.Time) (clients []*client, ridingKey string, ridingIDs []string) {
	clients = make([]*client, 0, len(rm.clients))
	// One roster entry per rider, however many sockets they hold — the same
	// person on a dashboard and a phone is one presence, and duplicate ids
	// are poison to keyed rendering downstream.
	seen := make(map[string]struct{}, len(rm.clients))
	riding, ridingIDs := rm.ridingLocked(now())
	pedalling := make(map[string]struct{}, len(ridingIDs))
	for _, id := range ridingIDs {
		pedalling[id] = struct{}{}
	}
	// A rider's connection is the best of their sockets (#2131): the same
	// person on a dashboard and a phone is one roster entry, and what
	// describes them is their best screen rather than whichever socket the
	// map happened to yield first.
	//
	// One socket, not two facts: the ping and the device word come from
	// the same client record, so the roster never says "12 ms" about the
	// laptop and "phone" about the handset sitting next to it. Collected
	// across every socket and applied after the roster is built, because
	// the entry itself is appended from the first socket seen.
	best := make(map[string]*client, len(rm.clients))
	for c := range rm.clients {
		clients = append(clients, c)
		if was, had := best[c.rider.ID]; !had || bestScreen(c, was) {
			best[c.rider.ID] = c
		}
		if _, dup := seen[c.rider.ID]; !dup {
			seen[c.rider.ID] = struct{}{}
			// The socket's captured rider plus the room's live view of
			// them: away is room state, not something a socket carries,
			// and riding is the window the room holds rather than the
			// watts on this one sample (#1016).
			rider := c.rider
			rider.AwayReason, rider.Away = rm.away[c.rider.ID]
			_, rider.Riding = pedalling[c.rider.ID]
			rider.InSession = rm.session.rides(c.rider.ID)
			// And what their board still has going, so a rider who joined
			// mid-clip catches up (#1681). Read here rather than drained:
			// a fire is one tick, the sound it started is not.
			rider.Sounding, rider.SoundingMs = rm.soundingLocked(c.rider.ID, now())
			tick.Roster = append(tick.Roster, rider)
		}
	}
	for i := range tick.Roster {
		if on, found := best[tick.Roster[i].ID]; found {
			// Zero when nothing has been measured yet, which omitempty
			// then drops — the client draws that as "no reading", never
			// as a round trip of nothing.
			tick.Roster[i].PingMs = on.ping()
			tick.Roster[i].Device = on.deviceKind
		}
	}
	ridingKey = strings.Join(riding, "\n")
	return clients, ridingKey, ridingIDs
}

// announceTick tells whoever listens outside the channel what the tick
// changed: the lobby, the saver, the XP keeper. Runs after rm.mu is released.
func (rm *channelState) announceTick(log *slog.Logger, now func() time.Time, saver SessionSaver, out *tickOut, last *tickMemory) {
	// Chat pings the lobby from its own HTTP write (#2437); the tick
	// pings for what only it sees change.
	if rm.changed != nil && (out.tick.State.Phase != last.phase || out.ridingKey != last.riding) {
		// Both sets: whoever stopped riding reads as stopped on a friend's
		// list, just as whoever started reads as riding (#2324).
		rm.changed(append(append([]string(nil), last.riders...), out.ridingIDs...))
		last.phase, last.riding, last.riders = out.tick.State.Phase, out.ridingKey, out.ridingIDs
	}
	// Stable roster order, so tiles do not shuffle every second.
	sort.Slice(out.tick.Roster, func(i, j int) bool { return out.tick.Roster[i].ID < out.tick.Roster[j].ID })

	rm.handOff(log, now, saver, out.ended)
	if out.sprintWinner != "" && rm.xp != nil {
		rm.xp.SprintWon(rm.channel, out.sprintWinner, now())
	}
	if out.gameWinner != "" && rm.xp != nil {
		rm.xp.GameWon(rm.channel, out.gameWinner, rm.gameMode, now())
	}
}

// sayPhaseLocked puts a line on the timeline when the session crosses into a
// phase worth talking about (#359), once per crossing. The transition is the
// trigger, never the control message: the clock closes a session as readily
// as a coach does, and a rider staring at the stage hears about both.
func (rm *channelState) sayPhaseLocked(state protocol.SessionState, now time.Time) {
	if state.Phase == rm.phaseSaid {
		return
	}
	rm.phaseSaid = state.Phase
	switch state.Phase {
	case "countdown":
		rm.events.add(sessionLine("started", "", state.WorkoutName, time.Time{}, now), now)
	case "done":
		// A game's session ends with the game's own line — who won, or that
		// it ended — and a second "Floor is Lava ended" would say it twice.
		if rm.session.game == "" {
			rm.events.add(sessionLine("ended", "", state.WorkoutName, time.Time{}, now), now)
		}
	}
}

// tickIntervalLocked is the room's clock: 4 Hz through a sprint window —
// the room's own, or a game's (#1578) — and 1 Hz otherwise. Caller holds rm.mu.
func (rm *channelState) tickIntervalLocked(now time.Time) time.Duration {
	inside := func(start, end time.Time) bool {
		return now.After(start.Add(-time.Second)) && now.Before(end.Add(time.Second))
	}
	if sp := rm.sprint; sp != nil && inside(sp.startsAt, sp.endsAt) {
		return burstTick
	}
	if w, ok := rm.game.(windowed); ok {
		if start, end, live := w.sprintWindow(); live && inside(start, end) {
			return burstTick
		}
	}
	return tickInterval
}
