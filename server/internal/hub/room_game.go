// A game in a voice channel (#31): starting and ending the mode, and — since
// #2597 — the session a game opens and closes. The rules live in the modes;
// this is the room's side of them.
package hub

import (
	"maps"
	"time"

	"github.com/google/uuid"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// startGame begins a mode. The refusal names the reason (#1582): a game
// already running and a mode that does not exist ask different things of
// the coach. Empty means started.
//
// A game is a session (docs/SPEC.md's glossary, #2597): with none open — or
// only the starter's own pick, never started — it opens one with the starter
// coaching, so its riders' rides, XP and recap are kept like a workout's. A
// game inside a workout session already running rides that session.
func (rm *room) startGame(mode string, rider protocol.Rider, now time.Time) string {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if rm.game != nil && !rm.game.done() {
		return refuseGameRunning
	}
	next := newGameMode(mode, now)
	if next == nil {
		return refuseNoSuchMode
	}
	rm.gameHost = rm.session.id
	if !rm.session.open() || rm.session.phase == "idle" {
		rm.session.begin(uuid.NewString(), rider.ID, rider.Name)
		rm.session.runGame(mode, gameModeNames[mode], now)
		rm.resetRunLocked(rider.ID)
		rm.gameHost = ""
	}
	rm.game = next
	rm.gameMode = mode
	rm.gameDoneAt = time.Time{}
	// The game's own roster (#1581): the tick merges rm.seen into it, so a
	// session start — which resets rm.seen for the new ride — does not blank
	// the names and FTPs the running game scores against.
	rm.gameRoster = make(map[string]protocol.Rider)
	return ""
}

// endGame stops the running mode; false when nothing was running (#1582).
// It is the coach's out and the only end Team Relay has — relay.done() is
// never true.
func (rm *room) endGame(now time.Time) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if rm.game == nil {
		return false
	}
	rm.stopGameLocked(now)
	return true
}

// stopGameLocked lets the running mode go, and with it the session it opened
// (#2597). It puts the ending on the timeline itself, unless the game already
// announced its own: advanceGameLocked stamped gameDoneAt on the tick it put a
// "won" or "gameEnded" line up, and a coach clearing a finished game's podium
// is not a second ending. Caller holds rm.mu.
func (rm *room) stopGameLocked(now time.Time) {
	if rm.game != nil && rm.gameDoneAt.IsZero() {
		gs := rm.game.state(now)
		rm.events.add(gameEndedLine(gs.Mode, gs.Round, now), now)
	}
	rm.game, rm.lastGame, rm.gameDoneAt, rm.gameHost = nil, nil, time.Time{}, ""
	rm.endGameSessionLocked(now)
}

// endAbandonedGameLocked ends a game nobody is left to play, with its session
// (#2597): it has no length to run out, and a session left running holds the
// room for good. After the presence grace, so a reload is not an end. Called
// from the empty room's tick. Caller holds rm.mu.
func (rm *room) endAbandonedGameLocked(now time.Time) {
	if rm.session.game != "" && rm.session.open() &&
		now.Sub(rm.lastPresentLocked()) >= presenceGrace {
		rm.stopGameLocked(now)
	}
}

// endOrphanedGameLocked ends a game whose workout session is over (#2830). A
// game started inside a workout rides that session and plays only its riders
// (ADR-0059); once the workout is done or ended it has none, and left running
// it scored everyone as silent, eliminated them on one tick and paid a win to
// whoever came first in the map. It ends the way a coach's End would: its own
// line, no podium. Caller holds rm.mu.
func (rm *room) endOrphanedGameLocked(now time.Time) {
	if rm.game == nil || rm.gameHost == "" || !rm.gameDoneAt.IsZero() {
		return
	}
	// state() first: the tick that crosses the workout's end sees it done.
	rm.session.state(now)
	if rm.session.id != rm.gameHost || !rm.session.open() {
		rm.stopGameLocked(now)
	}
}

// endGameSessionLocked closes a session a game opened, if one is open; the
// tick that sees it done saves its rides and writes its recap. Caller holds
// rm.mu.
func (rm *room) endGameSessionLocked(now time.Time) {
	if rm.session.game != "" && rm.session.open() {
		rm.session.end(now)
	}
}

// resetRunLocked starts a new ride's record: a workout's start or a game's
// session. The record must not blend two sessions, and the last one's
// presence must not leak into the new recap (ADR-0034). Caller holds rm.mu.
func (rm *room) resetRunLocked(starter string) {
	rm.record.reset()
	rm.seen = make(map[string]protocol.Rider)
	rm.seenOrder = nil
	rm.saved = false
	rm.voiceMs = make(map[string]int64)
	rm.present = make(map[string]*span)
	rm.presentSince = time.Time{}
	rm.startedBy = starter
}

// gameRosterLocked is the roster the game scores against: everyone the room
// has seen this session, remembered across a session start (#1581). Caller
// holds rm.mu.
func (rm *room) gameRosterLocked() map[string]protocol.Rider {
	if rm.gameRoster == nil {
		rm.gameRoster = make(map[string]protocol.Rider)
	}
	maps.Copy(rm.gameRoster, rm.seen)
	return rm.gameRoster
}
