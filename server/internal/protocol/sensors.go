package protocol

// SensorClaim is one socket telling the hub which sensors it has connected
// (#610).
//
// A Web Bluetooth grant cannot leave the browser that made it, so pairing
// itself stays client-owned (ARCHITECTURE seam 1). What the hub owns is which
// of a rider's sockets holds each kind — so the rider's other tabs and devices
// stop offering to pair a second one, and so only one of them feeds the ride
// record.
type SensorClaim struct {
	// Kinds this socket holds: "trainer", "heart-rate", "power-meter" or
	// "cadence". Always the socket's WHOLE current set, never a delta — a
	// message lost to a reconnect can then never leave a claim stuck behind.
	Held []string `json:"held"`
	// Which tab this is, so a reload reclaims what it already had instead of
	// locking itself out behind its own not-yet-reaped socket. Client-minted
	// and per-tab (sessionStorage); the hub treats it as an opaque label and
	// scopes it to the rider, so it can only ever address that rider's own
	// claims.
	Tab string `json:"tab,omitempty"`
	// A coarse word for the rider's OTHER screens to render: "phone",
	// "tablet" or "desktop". Never leaves the rider's own sockets.
	Device string `json:"device,omitempty"`
}

// SensorPairing is the hub's answer to a SensorClaim: what this socket ended
// up holding, and what one of the rider's other screens is already holding.
//
// It goes ONLY to the sockets of the rider it describes, and deliberately not
// on the tick: what a rider straps on is nobody else's business (privacy is
// architecture, WATTROOM.md), and the tick stays one message per voice
// channel per second (ARCHITECTURE seam 2) for state that changes every
// second — this changes only when somebody pairs or unpairs.
type SensorPairing struct {
	// Kinds this socket holds, as GRANTED — the claim minus anything another
	// of the rider's screens got to first.
	Held []string `json:"held,omitempty"`
	// Kind -> the device word of the rider's other screen holding it. What
	// the sensor cards render instead of a pair button.
	Elsewhere map[string]string `json:"elsewhere,omitempty"`
}
