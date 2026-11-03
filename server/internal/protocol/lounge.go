package protocol

// LoungeState is the shared half of a voice channel's lounge (ADR-0094): what
// any rider in the channel may flip for everyone in it. Ephemeral, like a
// channel event: the hub holds it while the channel is up and nothing keeps
// it. The zero value is the scene as it opens, so a channel nobody has touched
// sends nothing.
type LoungeState struct {
	// The desk lamp, which the scene opens with on.
	LampOff bool `json:"lampOff,omitempty"`
	// From LoungeWeathers. "" is rain, the scene's default.
	Weather string `json:"weather,omitempty"`
	// How often the cat has been petted since the channel came up. Every
	// screen wakes its cat when this goes up, so a pet is seen by everyone.
	Pets int `json:"pets,omitempty"`
	// From LoungeRadioStyles: house radio plays that style for everyone in the
	// channel. "" is records, real CC0 lofi tracks; "mix" rotates the three
	// generated styles.
	RadioStyle string `json:"radioStyle,omitempty"`
}

// LoungeWeathers is the closed set behind the lounge's window. The client keeps
// its own copy in web/src/lib/lounge/state.ts, read side by side in a test.
var LoungeWeathers = []string{"rain", "clear", "snow"}

// LoungeRadioStyles is the closed set of house radio styles a channel may
// pick. The client keeps its own copy in web/src/lib/lounge/state.ts.
var LoungeRadioStyles = []string{"mix", "lofi", "chip", "ambient"}

// HouseRadioTitle is house radio's line on the deck and in the channel's
// events: the station is generated, so it has no title of its own.
const HouseRadioTitle = "House radio"
