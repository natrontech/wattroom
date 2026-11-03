package hub

import (
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/natrontech/wattroom/server/internal/av"
	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Crew sessions (docs/SESSIONS.md): a session of the crew's own, in a room
// beside the voice channels, keyed by its place, with its own goroutine and
// tick. ponytail: the room is a channelState with no call in it — no voice,
// no deck — so every session feature rides it unchanged until the contract
// PR splits the struct.

// CrewAccess is the crew's door for a crew session's socket: whether this
// request's rider is in the crew, and the crew's id as spelled. Defined here,
// where it is consumed; channels.Service implements it. Nil leaves crew
// sessions shut.
type CrewAccess interface {
	AuthorizeCrew(r *http.Request, crew string) (rider protocol.Rider, canonical string, err error)
}

// SetCrewAccess wires the crew's door in.
func (h *Hub) SetCrewAccess(a CrewAccess) { h.crewAccess = a }

// OpenCrewSession opens a session of crew's with rider as its coach: the
// pick and the start the socket would send, in a room made for it. A road
// opens on its start line, as a plan's does, for the coach to start once
// the riders are there. The id is the session's; empty with a refusal.
func (h *Hub) OpenCrewSession(crew string, rider protocol.Rider, pick protocol.Control) (id, code, message string) {
	pick.Action = "pick"
	if refusal := checkPick(pick); refusal != "" {
		return "", "validation_error", refusal
	}
	id = uuid.NewString()
	place := protocol.CrewSessionPlace(crew, id)
	route, refused := h.askedRoute(pick, rider.ID, place)
	if refused != nil {
		return "", refused.Code, refused.Message
	}
	attached, name, refusal := h.sessionRoad(pick.WorkoutJSON, pick.WorkoutName, rider.ID, place)
	if refusal != "" {
		return "", "forbidden", refusal
	}
	pick.WorkoutJSON, pick.WorkoutName = attached, name
	rm := h.stateOf(place)
	rm.mu.Lock()
	rm.sessionID = id
	rm.mu.Unlock()
	code, message = rm.controlOn(pick, route, rider, h.now())
	if code == "" && route == nil {
		code, message = rm.control(protocol.Control{Action: "start"}, rider, h.now())
	}
	if code != "" {
		h.CloseChannel(place)
		return "", code, message
	}
	h.tellChannel(place, rider.ID)
	return id, "", ""
}

// CrewSessions is every crew session of crew's that is open, its start line
// included, as the crew's live list reads it. One room's lock at a time.
func (h *Hub) CrewSessions(crew string) []protocol.LiveSession {
	prefix := protocol.CrewSessionPlace(crew, "")
	out := []protocol.LiveSession{}
	for _, rm := range h.liveChannels() {
		if !strings.HasPrefix(rm.channel, prefix) {
			continue
		}
		if live, open := rm.liveSession(h.now(), true); open {
			live.Channel = ""
			out = append(out, live)
		}
	}
	return out
}

// KickCrew severs a rider from every crew session of crew's: a ban ends
// their seat in all of them, as it does in the crew's voice channels.
func (h *Hub) KickCrew(crew, userID string) {
	prefix := protocol.CrewSessionPlace(crew, "")
	for _, rm := range h.liveChannels() {
		if strings.HasPrefix(rm.channel, prefix) {
			h.Kick(rm.channel, userID)
		}
	}
}

// HandleCrewSessionWS is a crew session's socket: a member of the crew joins
// a session that is there. It never makes a room — OpenCrewSession does.
func (h *Hub) HandleCrewSessionWS(w http.ResponseWriter, r *http.Request) {
	if h.crewAccess == nil {
		http.NotFound(w, r)
		return
	}
	rider, crew, err := h.crewAccess.AuthorizeCrew(r, r.PathValue("crew"))
	if err != nil {
		if !errors.Is(err, av.ErrNoSession) && !errors.Is(err, av.ErrNotMember) {
			h.log.Error("crew session door", "crew", r.PathValue("crew"), "err", err)
			http.Error(w, "the crew could not be checked", http.StatusServiceUnavailable)
			return
		}
		http.Error(w, "not a member of this crew", http.StatusForbidden)
		return
	}
	place := protocol.CrewSessionPlace(crew, r.PathValue("id"))
	h.mu.Lock()
	_, there := h.states[place]
	h.mu.Unlock()
	if !there {
		http.Error(w, "this session has ended", http.StatusNotFound)
		return
	}
	h.serveRoom(w, r, rider, place)
}
