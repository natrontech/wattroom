package protocol

// Rider is presence: who is in the voice channel right now, with what the
// dashboard needs to render them. FTP crosses the wire so every screen can
// show %FTP — scoped to the channel by design, the same visibility
// WATTROOM.md grants live watts.
type Rider struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// The rider's crew role, as a voice channel reads it: "owner", "admin"
	// or "member" (#2438). Coach is not a role — it is the session's.
	Role     string `json:"role"`
	FtpWatts int    `json:"ftpWatts"`
	// For w/kg on the channel's screens — scoped to it like FTP, and for the
	// same reason: every contest in docs/SPEC.md is scored on it.
	WeightKg int `json:"weightKg"`
	// Lifetime XP, so the roster's faces wear the level ring the rest of the
	// app already shows (#690). Identity the channel may see, the same rule
	// the member list has followed since #253 — rides stay private.
	TotalXp int64 `json:"totalXp"`
	// Stepped out (#706). Presence, not a metric: the rider said so with the
	// Lounge's button, and every screen renders the mark instead of leaving
	// an open mic over an empty trainer.
	Away bool `json:"away,omitempty"`
	// Which kind of away, from AwayReasons; empty for the plain one. Voice
	// channel scope only, deliberately: the presence rail and anyone outside
	// the channel keep the plain away dot they have always had, because a
	// reason is a new detail about a person and a new detail does not get a
	// wider audience than the old one had.
	AwayReason string `json:"awayReason,omitempty"`
	// Pedalling right now (#1016) — watts inside the hub's riding window, so
	// a coast holds the mark and sitting down loses it. The server owns the
	// word: every screen used to decide it from the current sample's watts,
	// which flickered, and the friends page decided it from "a trainer is
	// talking", which never went out at all.
	Riding bool `json:"riding,omitempty"`
	// On the running session's timeline (ADR-0059). Everyone else in the
	// channel spectates it: not driven, not counted, and drawn apart.
	InSession bool `json:"inSession,omitempty"`
	// What this rider's soundboard has playing right now, and how far into it
	// the channel already is (#1681). A fire is one tick and gone
	// (ADR-0022/0033), so a rider who walked in halfway through a clip heard
	// silence and saw nobody playing anything; this is the same press, still
	// true a second later. The clip's real length is the listener's to know —
	// they fetch it — so the hub holds this for at most one clip's ceiling and
	// the client stops at the clip's own end.
	Sounding   string `json:"sounding,omitempty"`
	SoundingMs int64  `json:"soundingMs,omitempty"`
	// Round trip to this rider's socket in milliseconds (#2131), measured by
	// the server's own keepalive ping rather than reported by the client — so
	// it is safe to show one rider about another, which a self-reported number
	// would not be. Absent until the first ping of theirs has been answered.
	//
	// Scoped to the voice channel like the watts and the FTP above it, and
	// for the same reason: this is live data about someone in the channel,
	// visible inside it while they are there and nowhere else. It never
	// reaches ChannelPresence, the friends panel or anything public — a ping
	// is a weak location signal, and the voice channel is where WATTROOM.md
	// already grants that class of visibility.
	//
	// One rider, several sockets: the hub folds them to the LOWEST, which is
	// the rider's best screen. Their own breakdown per tab is the client's,
	// off the device labels #610 already carries.
	PingMs int `json:"pingMs,omitempty"`
	// What that same socket is running on (#2131) — "desktop", "phone" or
	// "tablet". The socket the ping came from, so the two describe one screen
	// rather than two of the rider's; absent from a client that has not said.
	// See DeviceKind for why this is the client's word and why that is fine
	// here when it would not be for the ping.
	Device string `json:"device,omitempty"`
}

// Administers reports whether the rider runs the crew: its owner or an
// admin, who may end a session somebody else is coaching (#2438).
func (r Rider) Administers() bool { return r.Role == "owner" || r.Role == "admin" }

// AwayState is a rider stepping out (#706) — the Lounge's button, never a
// timer: being off the bike is not being away, and a coach watching the stage
// is present and not pedalling.
//
// The whole state every time rather than a toggle, for the reason SensorClaim
// carries its whole set: a message lost to a reconnect can then never strand a
// rider away on everyone else's screen.
type AwayState struct {
	Away bool `json:"away"`
	// Why, from AwayReasons — "" is the plain away the button's face has
	// always sent, and the only thing one tap can produce. Ignored when Away
	// is false: coming back has no reason.
	Reason string `json:"reason,omitempty"`
}

// AwayReasons is the closed set behind the Away button's arrow. Closed and
// not free text: the voice channel draws this beside a rider's name, so a
// typed status would be a second chat nobody can reply in — and a closed set
// is the only kind the server can safely render to everyone (errors.md, the
// same reasoning as DeviceKind below).
//
// The words are shared vocabulary, not the client's: docs/SPEC.md's glossary
// owns them, and a screen that invents a synonym disagrees with the channel
// event the server writes for the same state.
var AwayReasons = []string{"nature", "food", "shower"}

// DeviceKind is what a socket says it is running on (#2131): one of
// "desktop", "phone" or "tablet", sent once when the socket opens and again
// on every reconnect, the way SensorClaim is resent.
//
// Its own message rather than a field on SensorClaim, which already carries a
// device word: that one is arbitration between a rider's OWN screens and is
// addressed back to them alone, so it says nothing to the voice channel and
// only exists once a sensor has been paired — which a spectator on a phone
// never does. This one is visible to the whole channel by design and arrives
// whether or not anything is paired.
//
// Unlike the ping beside it on the roster, this is the client's word for
// itself and nothing checks it. That is the right trade for a label this
// coarse: a rider who lies about being on a phone misleads nobody about
// anything, and the alternative is parsing a user agent, which is a
// fingerprint. Kept to the three words below for the same reason — the
// channel learns roughly what screen someone is on, never which device it is.
type DeviceKind struct {
	Kind string `json:"kind"`
}

// OwnConnection is what a socket is told about ITSELF, and about no other
// socket in the voice channel (#2131).
//
// Its own message rather than a field on Rider, deliberately: Rider is the
// roster, the roster rides every tick to everybody, and a "fill this in only
// for the socket it belongs to" rule on a broadcast struct is one careless
// refactor away from publishing every rider's address to their crew — a
// refactor that would pass every test asserting the tick's shape. Addressed
// delivery makes the guarantee structural. SensorPairing is delivered the
// same way for the same kind of reason (see tick.go, "Addressed to this
// socket alone").
//
// Nothing persists it. It is read off the request that opened the socket and
// sent straight back, so there is no stored address to export under Art. 15
// or to purge with an account.
type OwnConnection struct {
	// The address this socket reached the server from, as httpx.ClientAddr
	// resolves it: the last X-Forwarded-For hop behind the deploy's proxy
	// (#1824), else the peer.
	IP string `json:"ip"`
}

// Moved tells a rider's sockets in one voice channel that the crew's owner or
// an admin moved them into another (#2730), Discord's drag. The client goes
// there the way a sidebar click would, and the call comes along.
type Moved struct {
	// The voice channel they now belong in, and its name for the toast.
	Channel string `json:"channel"`
	Name    string `json:"name"`
	// Who moved them.
	By string `json:"by"`
}

// ChannelPresence is the hub's live answer for one voice channel (#251, #2436):
// the sidebar renders this shape. It rides the channel list rather than the
// channel's WS, but it is shared vocabulary like Rider — one canonical home,
// generated for the client like everything here.
type ChannelPresence struct {
	// Riders connected to the channel WS, counted as people, not sockets.
	Connected int    `json:"connected,omitempty"`
	Phase     string `json:"phase,omitempty"`
	// Display names — members-only server-side, scoped to the channel like
	// all live data. For rendering only: display names are not unique, so
	// anything asking "is this particular person in there?" reads RiderIDs
	// instead (#649).
	Riders []string `json:"riders,omitempty"`
	// The same riders by account id, in the same order as Riders.
	RiderIDs []string `json:"riderIds,omitempty"`
	// Who is in the voice channel, and who has a camera live (LiveKit webhooks).
	Voice   []string `json:"voice,omitempty"`
	Cameras []string `json:"cameras,omitempty"`
	// Names with live metrics in the last few seconds — the watt dot.
	Riding []string `json:"riding,omitempty"`
	// The same riders by account id, in the same order as Riding.
	RidingIDs []string `json:"ridingIds,omitempty"`
	// Who said away (#1742), by account id: the sidebar's dot and the rider's
	// tile used to disagree — away on the tile, online two panels over.
	AwayIDs []string `json:"awayIds,omitempty"`
	// The late-join radar: what is on and how far in, while a session runs.
	WorkoutName string `json:"workoutName,omitempty"`
	ElapsedSec  int    `json:"elapsedSec,omitempty"`
}
