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
}

// LoungeWeathers is the closed set behind the lounge's window. The client keeps
// its own copy in web/src/lib/lounge/state.ts, read side by side in a test.
var LoungeWeathers = []string{"rain", "clear", "snow"}

// HouseRadioTitle is house radio's line on the deck and in the channel's
// events: the station is generated, so it has no title of its own.
const HouseRadioTitle = "House radio"
