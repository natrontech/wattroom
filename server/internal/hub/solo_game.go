// A game alone (#4539): a game picked on a ride alone runs on that ride,
// judged here on the rider's own lane (rider_lane.go) by the same modes a
// session plays (mode_*.go). Before this the solo ride's game door opened a
// session in the rider's crew, which the crew saw and which started at once.
// A game alone opens no room, tells no crew and is saved as the ride alone it
// rides on: the client owns the ride, the hub only keeps the score.
package hub

import (
	"slices"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// soloGameModes are the modes that make sense with nobody else there
// (docs/spec/game-modes.md): each ends on its own when the rider is out or
// the course is played. SoloGames.svelte offers the same three.
var soloGameModes = []string{"watt-golf", "floor-is-lava", "backyard-ramp"}

// soloGameIdle is how long a game alone outlives its rider's last sample: a
// lobby socket's reconnect carries on the same game, and a tab that closed
// lets it go. Twice an elimination mode's disconnect grace, so the rules
// judge a dropout before the hub forgets the game.
const soloGameIdle = 2 * disconnectGrace

// soloGame is one rider's game alone. Guarded by riderLanes.mu.
type soloGame struct {
	id     string
	game   gameMode
	roster map[string]protocol.Rider
	// The last frame from the screen riding it, for soloGameIdle.
	heard time.Time
}

// soloGameFrame is the game's state, for the socket riding it.
func soloGameFrame(to *lobbyClient, id string, g *soloGame, now time.Time) []laneSend {
	if g == nil {
		return []laneSend{{to, protocol.LobbyLane{Game: &protocol.SoloGameFrame{ID: id, Gone: true}}}}
	}
	state := g.game.state(now)
	return []laneSend{{to, protocol.LobbyLane{Game: &protocol.SoloGameFrame{ID: id, State: &state}}}}
}

// soloGame handles one game frame from a screen riding alone. Refusals are
// lane errors to that screen; a sample or an end for a game the hub does not
// hold answers Gone, so the screen stops waiting on it.
func (l *riderLanes) soloGame(c *lobbyClient, cmd protocol.SoloGameControl) []laneSend {
	if cmd.ID == "" || len(cmd.ID) > protocol.MaxSoloGameID {
		return laneError(c, "validation_error", "That game has no name.")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.forgetQuietGamesLocked(now)
	held := l.games[c.rider]
	if held != nil && held.id != cmd.ID {
		held = nil
	}
	switch cmd.Action {
	case "start":
		if !slices.Contains(soloGameModes, cmd.Mode) {
			return laneError(c, "validation_error", "That game needs other riders.")
		}
		if cmd.FtpWatts < protocol.MinFtpWatts || cmd.FtpWatts > protocol.MaxFtpWatts {
			return laneError(c, "validation_error", "Set your FTP before a game: it scores against it.")
		}
		if held == nil {
			// One game per rider: a start replaces whatever ran before it.
			held = &soloGame{
				id:   cmd.ID,
				game: newGameMode(cmd.Mode, now),
				roster: map[string]protocol.Rider{c.rider: {
					ID: c.rider, FtpWatts: cmd.FtpWatts, WeightKg: cmd.WeightKg,
				}},
			}
			l.games[c.rider] = held
		}
		held.heard = now
		return soloGameFrame(c, cmd.ID, held, now)
	case "sample":
		if held == nil {
			return soloGameFrame(c, cmd.ID, nil, now)
		}
		// A second is a sample: the modes advance once a second
		// (game_timing.go), and a flood is dropped before it costs a frame.
		if cmd.Watts < 0 || cmd.Watts > protocol.MaxWatts || !l.allowLocked(c.rider, "game") {
			return nil
		}
		held.heard = now
		held.game.advance(now, map[string]int{c.rider: cmd.Watts}, held.roster)
		return soloGameFrame(c, cmd.ID, held, now)
	case "end":
		if held != nil {
			delete(l.games, c.rider)
		}
		return nil
	default:
		return laneError(c, "validation_error", "That is not something a game does.")
	}
}

// forgetQuietGamesLocked lets go of every game whose rider has said nothing
// for soloGameIdle. Called on each game frame, so the map holds at most the
// riders who played lately. Caller holds l.mu.
func (l *riderLanes) forgetQuietGamesLocked(now time.Time) {
	for rider, g := range l.games {
		if now.Sub(g.heard) > soloGameIdle {
			delete(l.games, rider)
		}
	}
}
