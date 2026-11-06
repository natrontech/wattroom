package hub

import (
	"slices"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// LoungeKeeper keeps a voice channel's room between calls. Defined here, where
// it is consumed; channels.LoungeKeeper implements it. Load may wait on the
// database, so it runs off the hub's locks; Save returns at once. Nil means no
// database, and a room lasts as long as the channel is up.
type LoungeKeeper interface {
	Load(channel string) (protocol.LoungeState, bool)
	Save(channel string, state protocol.LoungeState)
}

// SetLoungeKeeper wires the store that keeps the rooms.
func (h *Hub) SetLoungeKeeper(k LoungeKeeper) { h.loungeKeep = k }

// loungeMinGap bounds how often one rider may flip the lounge. It is a tap
// with nothing to answer (errors.md, fire-and-forget), so one over the limit
// drops in silence.
const loungeMinGap = 250 * time.Millisecond

// lounge takes a rider's flip of the lamp, the weather or the stove, a pet of
// the cat, a mood, or a pick or skip of house radio (ADR-0094). Anyone in
// the channel may: like the roadside, it paints and never reaches a ride.
func (h *Hub) lounge(rm *channelState, rider protocol.Rider, want protocol.LoungeState) {
	if !rm.allow("lounge", rider.ID, h.now(), loungeMinGap) {
		return
	}
	rm.setLounge(want)
	if h.loungeKeep != nil {
		h.loungeKeep.Save(rm.channel, rm.keptLounge())
	}
}

// room takes a rider's move in the cozy room: a seat, or an emote.
func (h *Hub) room(rm *channelState, rider protocol.Rider, act protocol.RoomAct) {
	if rm.allow("room", rider.ID, h.now(), loungeMinGap) {
		rm.setRoom(rider.ID, act, h.now())
	}
}

// emoteHolds is how long an emote shows. Long enough to be seen on a 1 Hz tick.
const emoteHolds = 6 * time.Second

// roomEmote is what a rider is doing for a moment.
type roomEmote struct {
	kind, to string
	seq      int
	until    time.Time
}

// setRoom records the move. A seat out of range lets the room seat them, and
// an emote outside the closed set is dropped: both are paint from a client
// this server may be older than.
func (rm *channelState) setRoom(rider string, act protocol.RoomAct, now time.Time) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if act.Seat != nil {
		if *act.Seat > 0 && *act.Seat <= protocol.MaxRoomSeat {
			rm.seats[rider] = *act.Seat
		} else {
			delete(rm.seats, rider)
		}
	}
	if slices.Contains(protocol.LoungeEmotes, act.Emote) {
		rm.emoteSeq++
		rm.emotes[rider] = roomEmote{kind: act.Emote, to: act.To, seq: rm.emoteSeq, until: now.Add(emoteHolds)}
	}
}

// roomStateOf is the tick's part of a rider: their seat and any emote still
// showing. The caller holds rm.mu.
func (rm *channelState) roomStateOf(rider *protocol.Rider, now time.Time) {
	rider.Seat = rm.seats[rider.ID]
	emote, ok := rm.emotes[rider.ID]
	if !ok {
		return
	}
	if !now.Before(emote.until) {
		delete(rm.emotes, rider.ID)
		return
	}
	rider.Emote, rider.EmoteTo, rider.EmoteSeq = emote.kind, emote.to, emote.seq
}

// restoreLounge puts back the room as it was left, unless a rider got there
// first: their flip is newer than anything stored.
func (rm *channelState) restoreLounge(state protocol.LoungeState) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if rm.lounge == (protocol.LoungeState{}) {
		rm.lounge = state
	}
}

// keptLounge is the room as it should outlive the channel. The radio's shift
// stays out: it is measured against this channel's clock and means nothing to
// the next one.
func (rm *channelState) keptLounge() protocol.LoungeState {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	kept := rm.lounge
	kept.RadioShiftMs = 0
	return kept
}

// setLounge stores what the scene should show. Rain is the default and so the
// zero value; a weather, style or mood outside its closed set leaves that as
// it was, and house radio's shift never goes back.
func (rm *channelState) setLounge(want protocol.LoungeState) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	if !slices.Contains(protocol.LoungeWeathers, want.Weather) {
		want.Weather = rm.lounge.Weather
	}
	if want.Weather == "rain" {
		want.Weather = ""
	}
	if want.RadioStyle != "" && !slices.Contains(protocol.LoungeRadioStyles, want.RadioStyle) {
		want.RadioStyle = rm.lounge.RadioStyle
	}
	if want.Mood != "" && !slices.Contains(protocol.LoungeMoods, want.Mood) {
		want.Mood = rm.lounge.Mood
	}
	want.RadioShiftMs = max(want.RadioShiftMs, rm.lounge.RadioShiftMs)
	// A pet is one more than the last, whatever the client counted: a lamp
	// flip carrying an old count cannot take it back, nor one message add ten.
	pets := rm.lounge.Pets
	if want.Pets > pets {
		pets++
	}
	want.Pets = pets
	rm.lounge = want
}

// loungeLocked is the tick's copy: nothing while the scene is as it opens.
func (rm *channelState) loungeLocked() *protocol.LoungeState {
	if rm.lounge == (protocol.LoungeState{}) {
		return nil
	}
	return new(rm.lounge)
}
