package protocol

// Cheer is a voice channel's reaction layer (#74) — and the spectator's one
// verb.
type Cheer struct {
	Emoji string `json:"emoji"`
	// Sender name, filled by the server: cheering is presence.
	From string `json:"from,omitempty"`
}

// Board is one rider firing a pad on their soundboard (#877, ADR-0033). The
// client sends only ClipID; the hub fills the sender from authenticated
// presence, and every listener fetches the clip and mixes it locally, on their
// own board fader.
//
// The hub deliberately does not check that the clip exists or belongs to the
// sender. Fetching is what authorizes (board.canHear), so a forged id costs a
// 404 on every machine and nothing else — and the check it would take is a
// database round trip on the voice channel's tick path.
//
// An empty ClipID is the rider stopping their own voice (#1321). Every
// listener already keys what is sounding by rider — SPEC's retrigger rule —
// so a stop is a fire with nothing to start.
type Board struct {
	ClipID string `json:"clipId"`
	// Filled by the server: firing is presence, and a listener needs to know
	// whose per-rider fader this rides.
	FromID string `json:"fromId,omitempty"`
	From   string `json:"from,omitempty"`
}

// Poke is one rider asking for another rider's attention. The client sends
// only To; the hub replaces every sender field from authenticated presence
// before routing it to the addressed rider's sockets.
//
// Between friends a poke is a DM line (#2721), and the DM service hands the
// hub the same shape with Dm set: the thread is where it lives, and At is
// the line's own time, so the socket and the thread's poll announce it once.
type Poke struct {
	To     string `json:"to,omitempty"`
	FromID string `json:"fromId,omitempty"`
	From   string `json:"from,omitempty"`
	At     int64  `json:"at,omitempty"`
	// The words a friend sent with it; never read from a client's socket.
	Text string `json:"text,omitempty"`
	// A line in your DM thread with the poker, not only a moment in a channel.
	Dm bool `json:"dm,omitempty"`
	// What is asked for (#3022): PokeKindPoke — the plain ask, and what an
	// empty kind means — or PokeKindBottle. Anything else is refused at the
	// socket.
	Kind PokeKind `json:"kind,omitempty"`
}

// PokeKind is the closed set a poke may carry (#3022).
type PokeKind string

const (
	// PokeKindPoke asks for attention now.
	PokeKindPoke PokeKind = "poke"
	// PokeKindBottle is a bottle handed up from the roadside (ADR-0064) to a
	// rider riding the voice channel's session: only across that channel,
	// never as a DM line, and never anywhere near anybody's trainer. The
	// rider's own screen holds it until their next recovery valley
	// (docs/SPEC.md, "The roadside"), so it lands on an easy block rather
	// than in the middle of an interval.
	PokeKindBottle PokeKind = "bottle"
)

// PokeCooldownSeconds is how long before one rider may poke the same rider
// again, through either door — a channel's socket or the DM thread. A poke
// asks one person's machine for attention and must not become a harassment
// button. A bottle takes the same cooldown on a key of its own, so handing
// one up never spends the poke.
const PokeCooldownSeconds = 10
