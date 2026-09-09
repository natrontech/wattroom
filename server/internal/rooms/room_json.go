package rooms

import (
	"strings"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// What a room says about itself on the wire: every payload shape the rooms
// handlers write, and the two vocabularies (cheers, crew role words) they
// share. Split from rooms.go (#1265).

// maxCheers caps the owner-curated reaction palette (#223).
const maxCheers = 8

// baseCheers is the stock reaction set (WATTROOM.md feel layer) — what a
// room speaks until its owner curates their own. Icon keys since #447; the
// client draws them.
var baseCheers = []string{"flame", "biceps-flexed", "party-popper", "skull", "rocket", "snowflake"}

// cheerSet parses the stored space-joined palette; ” means the base set.
func cheerSet(stored string) []string {
	if stored == "" {
		return baseCheers
	}
	return strings.Fields(stored)
}

// What a room shows about the riding its members did together (#995,
// RESEARCH.md §14.7, ADR-0036). Every figure here is either a whole-room sum
// — which orders nobody — or the CALLER's own turnout. No other rider's
// ride-derived number appears, which is what keeps this side of ADR-0034's
// line without a per-rider consent set.
type togetherJSON struct {
	// Seconds ridden in this room by everyone, ever. The cooperative total
	// RESEARCH.md §14.4 recommends as the room's primary number.
	Seconds int64 `json:"seconds"`
	// Sessions this month and last, so the room is ranked against its own past
	// rather than its members against each other (§14.3).
	SessionsThisMonth int64 `json:"sessionsThisMonth"`
	SessionsLastMonth int64 `json:"sessionsLastMonth"`
	// The room's last sessions, newest first: true where the caller was there.
	// Their own attendance and nobody else's — §14.8 forbids a strip that
	// grades anyone, and one that can only describe you cannot become a ladder.
	Attended []bool `json:"attended"`
}

// ADR-0038's crew: the layer above this room, and the thing the sidebar
// switches between. Identity only — a crew carries no voice, no deck, no
// session and no metrics, so there is nothing else here to send.
//
// Members only, like the code and the sound pack. Crew membership follows room
// membership, so someone who is not in this room is not in its crew and has no
// business knowing what the crew is called.
type roomCrewJSON struct {
	Id   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon,omitempty"`
	// The crew's logo (#1237), when one is set: the mark every surface draws
	// before falling back to the icon, then the initial.
	ImageURL string `json:"imageUrl,omitempty"`
	// The crew's join code (#1236), members only — the room's own code opens
	// nothing now, and the TV shows this one when the lounge is idle.
	Code string `json:"code,omitempty"`
	// What the caller is to the crew: owner | admin | member. The switcher's
	// owner mark reads it; it is small because the guarantee behind it is
	// about permissions, not a reading power (ADR-0038, second amendment).
	Role string `json:"role,omitempty"`
}

// One rider's week on a room's ordered board (#995, ADR-0036). Category is a
// bracket rather than a rank — it says who to compare with, which is the
// useful half (RESEARCH.md §14.4) — and it comes from the FTP and weight the
// room already shows on every member, not from rides outside this room.
type boardRowJSON struct {
	Id          string `json:"id"`
	DisplayName string `json:"displayName"`
	Kj          int64  `json:"kj"`
	Seconds     int64  `json:"seconds"`
	Category    string `json:"category"`
}

type memberJSON struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"displayName"`
	AvatarURL   *string `json:"avatarUrl,omitempty"`
	Role        string  `json:"role"`
	// Room-visible rider facts (#207) — the same numbers the roster already
	// shows on tiles; rides and history stay private. Lifetime XP joined
	// them in #253: the level is room-visible identity, the rides are not.
	TotalXp  int64  `json:"totalXp"`
	FtpWatts int16  `json:"ftpWatts"`
	WeightKg int16  `json:"weightKg"`
	JoinedAt string `json:"joinedAt"`
	// The badges this rider has earned (#703, ADR-0027) — the keys only, so
	// the room's page can show the crew what each other have done. Earned is
	// all there is: progress never leaves its owner.
	Badges []string `json:"badges,omitempty"`
	// A banned row that is ALSO banned at the crew (#1150): the owner's Unban
	// here lifts the room ban and nothing else, and the row has to say so
	// before they click expecting it to be over. Owner-only, like the row.
	CrewBanned bool `json:"crewBanned,omitempty"`
}

type medalJSON struct {
	Kind      string `json:"kind"`
	Rider     string `json:"rider"`
	AwardedAt string `json:"awardedAt"`
}

// riderPrefsJSON is what THIS rider has set for this room (#1100) — their
// own answers, never anybody else's, and absent entirely for a non-member.
// Grouped under `me` rather than flattened onto the room, so nothing reads
// like a property of the room that everybody shares.
type riderPrefsJSON struct {
	Notify  bool `json:"notify"`
	OnBoard bool `json:"onBoard"`
}

type roomJSON struct {
	// The row's key on the list, where a room you cannot enter has no slug
	// to be keyed by (#1205, doorOf). Not a door: nothing routes by id.
	ID string `json:"id,omitempty"`
	// Absent on a list row the caller may not enter — the slug is the door.
	Slug string `json:"slug,omitempty"`
	Name string `json:"name"`
	// Reserved for the opt-in public room directory (WATTROOM.md fast-follow,
	// #698): stored and round-tripped, but nothing reads it yet — no rider-facing
	// surface offers the toggle until the directory exists.
	Listed bool `json:"listed"`
	// Open to its crew (ADR-0038): crew-mates see it in their sidebar and
	// walk in without a code. The owner's to set (#1204); members only,
	// like the code — and absent for false, which is what a non-member gets.
	CrewVisible bool `json:"crewVisible,omitempty"`
	// Emoji identity mark (#223) — public like the name.
	Icon string `json:"icon,omitempty"`
	// Owner-set cue set ('base' | 'silent') — members only, like the code.
	SoundPack string `json:"soundPack,omitempty"`
	// The room's reaction palette (#223) — members only, like the sound pack.
	Cheers []string `json:"cheers,omitempty"`
	// Secret calendar-feed token (#245) — members only, like the code.
	IcsToken string `json:"icsToken,omitempty"`
	// The caller's own role; empty when they are not a member.
	Role    string       `json:"role,omitempty"`
	Members []memberJSON `json:"members,omitempty"`
	// A private room's named exceptions (ADR-0038, #1224), owner only:
	// crew-mates let in who have not walked in yet, and the crew-mates the
	// owner can see who are outside — the people a grant is for. Absent for
	// a room open to its crew, where everyone may already walk in.
	Invited     []memberJSON `json:"invited,omitempty"`
	CrewOutside []memberJSON `json:"crewOutside,omitempty"`
	// The caller's own preferences for this room (#1100); nil for a
	// non-member, who has none.
	Me *riderPrefsJSON `json:"me,omitempty"`
	// Recent medal history (#28) — members only, room-scoped like everything.
	Medals []medalJSON `json:"medals,omitempty"`
	// Crew streak and this month's collective kJ (#29) — cooperative pressure,
	// no individual numbers anywhere in it.
	StreakWeeks int   `json:"streakWeeks"`
	MonthKj     int64 `json:"monthKj"`
	// What this room's members did together (#995, ADR-0036). Members only,
	// like every other room number, and cooperative by construction — see
	// togetherJSON.
	//
	// Named `together`, not `crew`: ADR-0038 took that word for the layer
	// ABOVE a room, and this is the opposite thing — one room's own totals.
	// The rename is the cost ADR-0038 predicted when it recorded that "crew"
	// was already in use meaning the people in one room.
	Together *togetherJSON `json:"together,omitempty"`
	// The crew this room belongs to (ADR-0038). It takes the `crew` name that
	// togetherJSON above gave up (#1178) — the word means the layer above a
	// room now, and one payload cannot spend it on both.
	Crew *roomCrewJSON `json:"crew,omitempty"`
	// What the caller may do here without opening it (#1149): open |
	// private | locked | admin. List view only — a room you are looking at
	// has already answered by rendering.
	Access string `json:"access,omitempty"`
	// The outsider view's two facts (#1236): may this signed-in non-member
	// walk in — a crew member at an open room's door, or someone let in —
	// and, when not, are they at least in the room's crew. The door reads
	// "private, ask to be let in" for a crew-mate and "a crew you are not in"
	// for everyone else, and offers a button only when it would work.
	CanEnter bool `json:"canEnter,omitempty"`
	InCrew   bool `json:"inCrew,omitempty"`
	// Whether this room has turned its ordered board on (ADR-0036). Off is the
	// default and stays the default: being in a room must not put a rider on a
	// board. Members only, like the setting it mirrors.
	BoardEnabled bool `json:"boardEnabled,omitempty"`
	// This week's board, present only when the room has enabled it. Resets on
	// Monday with the streak's week — a bad week is never permanent.
	Board []boardRowJSON `json:"board,omitempty"`
	// Planned rides (#116): the full upcoming list for members, and just the
	// next one for the list view — the nav shows where the action will be.
	Upcoming    []scheduledJSON `json:"upcoming,omitempty"`
	NextSession *nextJSON       `json:"nextSession,omitempty"`
	// List-view presence: how many members exist, plus everything live the hub
	// knows (#251) — connected riders, phase, voice, cameras, riding, and the
	// running session's name and elapsed. Members-only, room-scoped like every
	// live signal.
	MemberCount int `json:"memberCount,omitempty"`
	// Lines from other people since you last opened this room (#389) — the
	// rail's whole argument for spending width on a room you are not looking
	// at. Per-rider, so it does not belong in RoomPresence.
	Unread int `json:"unread,omitempty"`
	// The last thing said here (#468) — the one-line preview and the
	// recency that lets a room sort next to a DM in the messages list.
	LastChat *lastChatJSON `json:"lastChat,omitempty"`
	protocol.RoomPresence
}

type lastChatJSON struct {
	From string `json:"from"`
	Text string `json:"text"`
	// The line was an image (#279) — it has no text to preview.
	HasImage bool  `json:"hasImage,omitempty"`
	At       int64 `json:"at"`
}

// crewRoleWord turns the two booleans the list query carries into the word
// the payload speaks. Member is what is left when neither is set: a room on
// the rail is a room in a crew the caller is in (#1236).
func crewRoleWord(owner, admin bool) string {
	switch {
	case owner:
		return "owner"
	case admin:
		return "admin"
	default:
		return "member"
	}
}
