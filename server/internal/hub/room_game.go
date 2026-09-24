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
	if !rm.session.open() || rm.session.phase == "idle" {
		rm.session.begin(uuid.NewString(), rider.ID, rider.Name)
		rm.session.runGame(mode, gameModeNames[mode], now)
		rm.resetRunLocked(rider.ID)
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
	rm.game, rm.lastGame, rm.gameDoneAt = nil, nil, time.Time{}
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
