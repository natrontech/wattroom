// The room's goroutine: one per live room, one tick a second. Every mutation
// the room makes arrives on its channels and is applied here, which is what
// makes the room's fields safe to touch without each caller taking a lock.
package hub

import (
	"context"
	"encoding/json"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/safego"
)

const tickInterval = time.Second

// run broadcasts one tick per interval while anyone is connected. The tick
// always carries the session state and roster — the timer must advance on
// screens even when nobody is pedalling yet.
// ponytail: the ticker runs while the room is empty; rooms are cheap and few,
// stop-on-empty can land with room GC if it ever shows up in a profile.
func (rm *room) run(log *slog.Logger, now func() time.Time, saver SessionSaver) {
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
	lastPhase, lastRiding := "", ""
	lastTick := now()
	for {
		select {
		case <-rm.stop:
			// The room was deleted: no tick, and no session save — the
			// durable row it would reference is already gone.
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
			// Nobody to tick to, but the clock still runs (audit 2026-09-09):
			// a session whose last rider closed the tab at minute 58 ends at
			// 60 and saves then, dated right — not on the next visit.
			state := rm.session.state(now())
			// Said now, at the moment it happened: skipping the line here
			// left phaseSaid at "running", and the next visitor watched the
			// session "end" live, hours late (audit 2026-09-09).
			rm.sayPhaseLocked(state, now())
			ended := rm.closeLocked(state, now(), saver != nil)
			locked = false
			rm.mu.Unlock()
			rm.handOff(log, now, saver, ended)
			continue
		}
		gameWinner := rm.advanceGameLocked(now())
		// Drain a bounded slice per tick and CARRY the overflow — a burst
		// above the per-tick cap used to vanish silently (#219).
		chatNow := rm.chat
		if len(chatNow) > 32 {
			chatNow = rm.chat[:32]
			rm.chat = append([]protocol.ChatLine(nil), rm.chat[32:]...)
		} else {
			rm.chat = nil
		}
		reactsNow := rm.reacts
		if len(reactsNow) > 64 {
			reactsNow = rm.reacts[:64]
			rm.reacts = append([]protocol.ChatReactionCount(nil), rm.reacts[64:]...)
		} else {
			rm.reacts = nil
		}
		editsNow := rm.edits
		if len(editsNow) > 64 {
			editsNow = rm.edits[:64]
			rm.edits = append([]protocol.ChatEdit(nil), rm.edits[64:]...)
		} else {
			rm.edits = nil
		}
		idsNow := rm.chatIDs
		rm.chatIDs = nil
		// Resolved before the drain so a transition's own line rides the tick
		// that carries the transition, not the one after it.
		state := rm.session.state(now())
		// After state() has promoted a finished countdown: mood() never
		// advances anything, and running is the only phase with a block.
		state.TargetRpm = rm.session.mood(now()).TargetRPM()
		rm.sayPhaseLocked(state, now())
		// Whoever has been gone longer than the grace window (#984). The tick
		// is the room's only clock, and the line has to be resolved before the
		// drain below or it waits a whole second for the next one.
		rm.sayDepartedLocked(now())
		rm.accrueVoiceLocked(state.Phase, dt)
		sprintNow, sprintWinner := rm.scoreSprintLocked(now())
		eventsNow := rm.events.drain()
		tick := protocol.ServerTick{
			At:            now().UnixMilli(),
			State:         state,
			Jukebox:       rm.music.snapshot(),
			Cheers:        rm.cheers,
			Board:         rm.board,
			Chat:          chatNow,
			ChatReactions: reactsNow,
			ChatEdits:     editsNow,
			ChatIDs:       idsNow,
			Events:        eventsNow,
			Sprint:        sprintNow,
			Game:          rm.lastGame,
			Execution: func() map[string]float64 {
				out := make(map[string]float64, len(rm.seen))
				for id := range rm.seen {
					if score, scored := rm.record.execution(id); scored {
						out[id] = score
					}
				}
				return out
			}(),
			Voice:  rm.voiceIDsLocked(),
			Riders: rm.metrics,
			Roster: make([]protocol.Rider, 0, len(rm.clients)),
		}
		rm.metrics = make(map[string]protocol.RiderMetrics)
		rm.cheers = nil
		rm.board = nil
		// Who the session has seen, sampled once a second while it runs
		// (ADR-0034). Cheap, and it needs no join/leave hook: the roster is
		// right here, already folded across a rider's several screens.
		if tick.State.Phase == "countdown" || tick.State.Phase == "running" || tick.State.Phase == "paused" {
			rm.sawLocked(now())
		}
		// The session just closed: hand the ride record to the saver exactly
		// once. Snapshot under the lock, persist outside it (hub discipline:
		// no I/O while holding a room mutex).
		ended := rm.closeLocked(tick.State, now(), saver != nil)
		// The stored row, on the first tick after the write came back.
		tick.Recap = rm.recap
		rm.recap = nil
		clients := make([]*client, 0, len(rm.clients))
		// One roster entry per rider, however many sockets they hold — the same
		// person on a dashboard and a phone is one presence, and duplicate ids
		// are poison to keyed rendering downstream.
		seen := make(map[string]struct{}, len(rm.clients))
		riding, ridingIDs := rm.ridingLocked(now())
		pedalling := make(map[string]struct{}, len(ridingIDs))
		for _, id := range ridingIDs {
			pedalling[id] = struct{}{}
		}
		for c := range rm.clients {
			clients = append(clients, c)
			if _, dup := seen[c.rider.ID]; !dup {
				seen[c.rider.ID] = struct{}{}
				// The socket's captured rider plus the room's live view of
				// them: away is room state, not something a socket carries,
				// and riding is the window the room holds rather than the
				// watts on this one sample (#1016).
				rider := c.rider
				_, rider.Away = rm.away[c.rider.ID]
				_, rider.Riding = pedalling[c.rider.ID]
				// And what their board still has going, so a rider who joined
				// mid-clip catches up (#1681). Read here rather than drained:
				// a fire is one tick, the sound it started is not.
				rider.Sounding, rider.SoundingMs = rm.soundingLocked(c.rider.ID, now())
				tick.Roster = append(tick.Roster, rider)
			}
		}
		ridingKey := strings.Join(riding, "\n")
		spoke := len(tick.Chat) > 0
		// Claim answers ride out with this tick but not IN it (#610): a
		// rider's device inventory is theirs, and the tick goes to the room.
		pairing := rm.drainPairingLocked()
		pokes := rm.drainPokesLocked()
		locked = false
		rm.mu.Unlock()
		// Someone spoke: every sidebar's unread count for this room just went
		// stale, and a rider who is NOT standing in the room announces the
		// line off that count (#568). Without this it waited for the lobby's
		// 60 s fallback poll.
		if rm.changed != nil && (tick.State.Phase != lastPhase || ridingKey != lastRiding || spoke) {
			lastPhase, lastRiding = tick.State.Phase, ridingKey
			rm.changed()
		}
		// Stable roster order, so tiles do not shuffle every second.
		sort.Slice(tick.Roster, func(i, j int) bool { return tick.Roster[i].ID < tick.Roster[j].ID })

		rm.handOff(log, now, saver, ended)
		if sprintWinner != "" && rm.xp != nil {
			rm.xp.SprintWon(rm.slug, sprintWinner, now())
		}
		if gameWinner != "" && rm.xp != nil {
			rm.xp.GameWon(rm.slug, gameWinner, rm.gameMode, now())
		}

		metricTicks.Inc()
		// Once for the room, not once per rider: the tick is identical for
		// everyone in it — roster, metrics, game state — and marshalling it
		// per client put the same work N times on the critical path between
		// one slow socket and the next (#670).
		payload, err := json.Marshal(protocol.ServerMessage{Tick: &tick})
		if err != nil {
			// Half a tick is worse than none: skip the broadcast and say so.
			logger(log).Error("tick could not be marshalled", "room", rm.slug, "err", err)
			payload = nil
		}
		for _, c := range clients {
			if payload != nil {
				c.send(payload)
			}
			// Addressed to this socket alone, so it cannot be folded into the
			// tick — but it rides the same queue, so it keeps its order.
			if answer, ok := pairing[c]; ok {
				c.sendJSON(log, protocol.ServerMessage{Pairing: &answer})
			}
			for _, pending := range pokes[c] {
				poke := pending
				c.sendJSON(log, protocol.ServerMessage{Poke: &poke})
			}
		}
	}
}

// sessionEnd is what one tick hands off when the session has just closed:
// the ride record for the saver, the event for the XP keeper, the recap for
// its keeper. Snapshotted under the lock, persisted outside it.
type sessionEnd struct {
	records []RiderRecord
	meta    protocol.SessionState
	closed  *SessionClosed
	recap   *protocol.SessionRecap
	recaps  RecapKeeper
}

// closeLocked snapshots the session exactly once, on the tick its phase
// crosses to done — nil on every other tick. Caller holds rm.mu.
func (rm *room) closeLocked(state protocol.SessionState, now time.Time, saving bool) *sessionEnd {
	if state.Phase != "done" || rm.saved {
		return nil
	}
	rm.saved = true
	end := &sessionEnd{meta: state}
	if saving {
		for _, id := range rm.seenOrder {
			if record, ok := rm.record.byRider[id]; ok {
				end.records = append(end.records, RiderRecord{Rider: rm.seen[id], Samples: record.samples})
			}
		}
	}
	if rm.xp != nil {
		end.closed = rm.closedLocked(state, now)
	}
	// A session that ran leaves a recap; one that never started leaves
	// nothing, which is what an empty presence map means.
	if rm.recaps != nil && len(rm.present) > 0 {
		snapshot := rm.recapLocked(state, now)
		end.recap, end.recaps = &snapshot, rm.recaps
	}
	return end
}

// handOff persists a closed session outside the lock, like every other
// hand-off; nil is every tick on which nothing closed.
func (rm *room) handOff(log *slog.Logger, now func() time.Time, saver SessionSaver, end *sessionEnd) {
	if end == nil {
		return
	}
	if end.records != nil {
		// Fire and hand off: the tick loop never blocks on the database.
		// The saver owns timeouts and retries (#235); the goroutine exits
		// when its bounded retry policy returns — minutes at worst — and
		// the hub counts it so a shutdown waits for it.
		rm.detach(log, "session save "+rm.slug, func() {
			saver.SaveSession(context.Background(), rm.slug,
				end.meta.WorkoutName, end.meta.WorkoutJSON,
				time.UnixMilli(now().UnixMilli()-int64(end.meta.Elapsed)*1000), end.records)
		})
	}
	// The keeper returns at once (it queues its own I/O).
	if end.closed != nil {
		rm.xp.SessionClosed(*end.closed)
	}
	// On its own goroutine because this one reaches the database: the keeper
	// writes the row and posts it back for the next tick to carry (ADR-0034).
	if end.recap != nil {
		slug := rm.slug
		rm.detach(log, "session recap "+slug, func() { end.recaps.SaveRecap(slug, *end.recap) })
	}
}

// detach runs fn on its own goroutine like safego.Go, counted on the hub's
// hand-offs while it runs so Drain can wait for it.
func (rm *room) detach(log *slog.Logger, where string, fn func()) {
	if rm.pending == nil {
		safego.Go(log, where, fn)
		return
	}
	rm.pending.Add(1)
	safego.Go(log, where, func() {
		defer rm.pending.Done()
		fn()
	})
}

// sayPhaseLocked puts a line on the timeline when the session crosses into a
// phase worth talking about (#359), once per crossing. The transition is the
// trigger, never the control message: the clock closes a session as readily
// as a coach does, and a rider staring at the stage hears about both.
func (rm *room) sayPhaseLocked(state protocol.SessionState, now time.Time) {
	if state.Phase == rm.phaseSaid {
		return
	}
	rm.phaseSaid = state.Phase
	switch state.Phase {
	case "countdown":
		rm.events.add(sessionLine("started", "", state.WorkoutName, time.Time{}, now), now)
	case "done":
		rm.events.add(sessionLine("ended", "", state.WorkoutName, time.Time{}, now), now)
	}
}

// scoreSprintLocked renders the sprint for the tick and names the winner on
// the one tick that scores it (#467). Caller holds rm.mu.
func (rm *room) scoreSprintLocked(now time.Time) (*protocol.SprintState, string) {
	scoredBefore := rm.sprint != nil && rm.sprint.scored
	// Scored against who is still here (#1577): leave at second six of
	// fifteen and the podium — and its XP — used to be yours anyway.
	roster := rm.seen
	if rm.sprint != nil && !scoredBefore {
		roster = make(map[string]protocol.Rider, len(rm.seen))
		for id, rider := range rm.seen {
			if rm.presentLocked(id) {
				roster[id] = rider
			}
		}
	}
	state := rm.sprint.state(now, roster)
	if scoredBefore || rm.sprint == nil || !rm.sprint.scored || len(rm.sprint.results) < minSprintField {
		return state, ""
	}
	return state, rm.sprint.results[0].RiderID
}

// closedLocked is the session as the XpKeeper hears it (#467): everyone who
// rode, everyone who was in voice, and who pressed start. Caller holds rm.mu.
func (rm *room) closedLocked(state protocol.SessionState, now time.Time) *SessionClosed {
	ev := &SessionClosed{Slug: rm.slug, StartedBy: rm.startedBy, Seconds: state.Elapsed, At: now}
	for _, id := range rm.seenOrder {
		ev.Riders = append(ev.Riders, SessionRider{
			ID: id, Rode: rm.record.count(id) >= MinRideSamples,
			VoiceSeconds: int(rm.voiceMs[id] / 1000),
		})
	}
	// Voice-only people — a coach without a trainer, a spectator on the
	// call — in a stable order, since the map has none.
	var listeners []string
	for id := range rm.voiceMs {
		if _, rode := rm.seen[id]; !rode {
			listeners = append(listeners, id)
		}
	}
	sort.Strings(listeners)
	for _, id := range listeners {
		ev.Riders = append(ev.Riders, SessionRider{ID: id, VoiceSeconds: int(rm.voiceMs[id] / 1000)})
	}
	return ev
}

// gameLinger keeps a finished game's podium on the tick as long as the
// sprint keeps its own (#1579); then the room lets the game go, instead of
// stapling "done" to every tick until a coach pressed end.
const gameLinger = sprintLinger

// tickIntervalLocked is the room's clock: 4 Hz through a sprint window —
// the room's own, or a game's (#1578) — and 1 Hz otherwise. Caller holds rm.mu.
func (rm *room) tickIntervalLocked(now time.Time) time.Duration {
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

// advanceGameLocked runs the game's tick and owns its ending (#1575, #1579):
// the first tick that sees it done puts the winner on the timeline once and
// names them for the XP ledger; gameLinger later the game is let go. Caller
// holds rm.mu; the returned winner is handed to the keeper after the unlock.
func (rm *room) advanceGameLocked(now time.Time) (winner string) {
	if rm.game == nil {
		rm.lastGame = nil
		return ""
	}
	samples := make(map[string]int, len(rm.metrics))
	for id, m := range rm.metrics {
		samples[id] = m.Watts
	}
	rm.game.advance(now, samples, rm.gameRosterLocked())
	gs := rm.game.state(now)
	rm.lastGame = &gs
	if !rm.game.done() {
		return ""
	}
	if rm.gameDoneAt.IsZero() {
		rm.gameDoneAt = now
		if len(gs.Podium) > 0 {
			rm.events.add(sessionLine("won", gs.Podium[0].Name, gs.Mode, time.Time{}, now), now)
			winner = gs.Podium[0].RiderID
		}
		return winner
	}
	if now.Sub(rm.gameDoneAt) > gameLinger {
		rm.game, rm.lastGame, rm.gameDoneAt = nil, nil, time.Time{}
	}
	return ""
}
