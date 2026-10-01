package hub

import (
	"sort"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/race"
	"github.com/natrontech/wattroom/server/internal/road"
)

// modeRace is a race on a road (#3658, ADR-0067): the room's side of
// server/internal/race. The rules are that package's; this counts down to
// the flag, freezes who rides it and on what numbers, steps it once a second,
// holds it while the coach neutralises it, and draws the closing card.
const modeRace = "race"

// raceBurstETA is docs/SPEC.md "Races": the tick goes to 4 Hz once the
// leader is this close to the line.
const raceBurstETA = 30 * time.Second

// raceRun is one race in a voice channel. Not goroutine-safe; the room's
// mutex guards it, as it guards every mode.
type raceRun struct {
	profile road.Road
	// The flag drops after the session's countdown (docs/SPEC.md "Races").
	flag time.Time
	// Nil until the flag, and for good when the flag found too few riders.
	race *race.Race
	void string
	// Who rides it, by the name they had at the flag.
	names map[string]string
	// When the coach neutralised it; zero while it races.
	heldAt time.Time
	// The second last stepped, and whether the leader was within
	// raceBurstETA of the line then.
	at    time.Time
	burst bool
}

func newRaceRun(profile road.Road, now time.Time) *raceRun {
	return &raceRun{profile: profile, flag: now.Add(countdownSeconds * time.Second)}
}

// raceLocked is the race the session is for, while it holds the room: nil
// when the game is another, or a new session has started since. Caller
// holds rm.mu.
func (rm *channelState) raceLocked() *raceRun {
	if r := raceOf(rm.game); r != nil && rm.session.game == modeRace {
		return r
	}
	return nil
}

// raceOf is the running game's race, or nil when the game is another mode.
func raceOf(g gameMode) *raceRun {
	if s, ok := g.(*sampledGame); ok {
		g = s.gameMode
	}
	r, _ := g.(*raceRun)
	return r
}

// due says whether the flag has dropped on a field not yet lined up.
func (r *raceRun) due(now time.Time) bool {
	return r.race == nil && r.void == "" && !now.Before(r.flag)
}

// line freezes the field at the flag (ADR-0067): each rider's weight, the
// Category their race FTP puts them in, and why the race cannot place them —
// a number nobody chose, a weight too fresh or unconfirmed, or a trainer
// WattRoom holds the watts on (ADR-0084). A profile saved after this moves
// the roster and never the race.
func (r *raceRun) line(field []protocol.Rider, ergByRoad map[string]bool) {
	entrants := make([]race.Entrant, 0, len(field))
	r.names = make(map[string]string, len(field))
	for _, rider := range field {
		why := protocol.Unranked(rider, r.flag)
		if why == "" && ergByRoad[rider.ID] {
			why = protocol.UnrankedUntimeable
		}
		entrants = append(entrants, race.Entrant{
			ID: rider.ID, WeightKg: float64(rider.WeightKg),
			Category: protocol.RaceCategory(rider), Unranked: why,
		})
		r.names[rider.ID] = rider.Name
	}
	started, err := race.New(r.profile, entrants, r.flag)
	if err != nil {
		r.void = protocol.RaceVoidTooFew
		return
	}
	r.race = started
}

// neutralise holds the race, or lifts the hold (#3658): the coach's, and
// only while it is on. False when there is nothing to hold or lift.
func (r *raceRun) neutralise(on bool, now time.Time) bool {
	if r.race == nil || r.race.Done() || on == !r.heldAt.IsZero() {
		return false
	}
	if on {
		r.heldAt = now
		return true
	}
	r.race.Neutralised(r.heldAt, now)
	r.heldAt = time.Time{}
	return true
}

// close ends a race under way where it stands, so the coach's End still
// draws its card (#3658); false before the flag or once it is over.
func (r *raceRun) close() bool {
	return r.race != nil && r.race.Close()
}

// advance steps the race through the second just ridden. Before the flag,
// while held, and once it is over there is nothing to step.
func (r *raceRun) advance(now time.Time, samples map[string]int, _ map[string]protocol.Rider) {
	if r.race == nil || !r.heldAt.IsZero() || r.race.Done() {
		return
	}
	r.race.Step(now, samples)
	eta, riding := r.race.LeaderETA()
	r.at, r.burst = now, riding && now.After(r.race.Klaxon()) && eta <= raceBurstETA
}

// sprintWindow is the 4 Hz finish: the second just stepped, while the leader
// still riding is within raceBurstETA of the line. Read afresh each second,
// so a leader over it hands the window to the next, and a hold or a tail
// minutes back lets the tick down to 1 Hz.
func (r *raceRun) sprintWindow() (start, end time.Time, ok bool) {
	if !r.burst || r.done() || !r.heldAt.IsZero() {
		return time.Time{}, time.Time{}, false
	}
	return r.at, r.at.Add(time.Second), true
}

func (r *raceRun) done() bool {
	return r.void != "" || r.race != nil && r.race.Done()
}

func (r *raceRun) state(time.Time) protocol.GameState {
	st := &protocol.RaceState{
		FlagAtMs:    r.flag.UnixMilli(),
		KlaxonAtMs:  r.flag.Add(protocol.RaceNeutralSeconds * time.Second).UnixMilli(),
		Neutralised: !r.heldAt.IsZero(),
		Void:        r.void,
	}
	phase := "running"
	if r.race != nil {
		st.KlaxonAtMs = r.race.Klaxon().UnixMilli()
	}
	if r.done() {
		phase = "done"
		st.Results = r.results()
	}
	return protocol.GameState{Mode: modeRace, Phase: phase, Riders: map[string]protocol.GameRider{}, Race: st}
}

// results is the closing card (ADR-0067): each Category's finishers by their
// time from the klaxon, the unplaced apart and told why. Never stored.
func (r *raceRun) results() []protocol.RaceBracket {
	if r.race == nil {
		return nil
	}
	klaxon := r.race.Klaxon().UnixMilli()
	finishers := func(fs []race.Finisher) []protocol.RaceFinisher {
		out := make([]protocol.RaceFinisher, len(fs))
		for i, f := range fs {
			out[i] = protocol.RaceFinisher{RiderID: f.ID, Name: r.names[f.ID], Ms: f.FinishMs - klaxon, Why: f.Why}
		}
		return out
	}
	var out []protocol.RaceBracket
	for _, res := range r.race.Results() {
		out = append(out, protocol.RaceBracket{
			Category: res.Category, Placed: finishers(res.Placed), Unranked: finishers(res.Unranked), Alone: res.Alone,
		})
	}
	return out
}

// entrants adds the race's riders to a set of who sees its finishes and card.
func (r *raceRun) entrants(to map[string]struct{}) map[string]struct{} {
	if to == nil {
		to = make(map[string]struct{}, len(r.names))
	}
	for id := range r.names {
		to[id] = struct{}{}
	}
	return to
}

// world is the race on the tick: each racer's own place, since a race rides
// no shared bunch (ADR-0067). Nil before the flag.
func (r *raceRun) world() *protocol.World {
	if r.race == nil {
		return nil
	}
	return &protocol.World{Racers: r.race.Racers()}
}

// neutraliseLocked is the coach's hold on the race, or its lift, answered as
// control answers. Caller holds rm.mu.
func (rm *channelState) neutraliseLocked(on bool, now time.Time) (code, message string) {
	r := raceOf(rm.game)
	switch {
	case r != nil && r.neutralise(on, now):
		return "", ""
	case on:
		return "invalid_request", "Only a race under way can be neutralised."
	}
	return "invalid_request", "The race is not neutralised."
}

// raceFieldLocked is who lines up at the flag: every rider the session has on
// its timeline and still in the channel.
// Caller holds rm.mu.
func (rm *channelState) raceFieldLocked() (field []protocol.Rider, ergByRoad map[string]bool) {
	byID := make(map[string]protocol.Rider)
	ergByRoad = make(map[string]bool)
	for c := range rm.clients {
		if !rm.session.rides(c.rider.ID) {
			continue
		}
		// One entry per rider: the profile is the same on every socket
		// (withProfile), and of the 90-day bests each door read, the
		// highest — never whichever socket the map yields.
		if held, ok := byID[c.rider.ID]; !ok || c.rider.Best20mWatts > held.Best20mWatts {
			byID[c.rider.ID] = c.rider
		}
		// Any of the rider's screens holding the watts holds the race's.
		ergByRoad[c.rider.ID] = ergByRoad[c.rider.ID] || c.ergByRoad
	}
	for _, rider := range byID {
		field = append(field, rider)
	}
	sort.Slice(field, func(i, j int) bool { return field[i].ID < field[j].ID })
	return field, ergByRoad
}
