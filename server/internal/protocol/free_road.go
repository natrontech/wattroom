package protocol

// FreeRoad is the road a free rider rides in a voice channel (#3117,
// ADR-0059): the road's identity, SHA-256 of its packed bytes in hex as
// $lib/road's roadHash takes it. Empty is off a road. The hub keeps it and
// never sends it on: channel-mates on the same road find each other through
// the tick's FreeRoads, by number.
type FreeRoad struct {
	Key string `json:"key,omitempty"`
}

// FreeRoadKeyLen is a road key's length: SHA-256 in hex.
const FreeRoadKeyLen = 64

// FreeRoadPlace is where one free rider is on a road at least one other free
// rider in the channel rides too (#3117). Road numbers the road for this tick
// alone: equal numbers are one road, and the number says nothing else. M is
// metres along it from its first sample, as the rider's own samples count
// them. Never ranked (ADR-0036).
type FreeRoadPlace struct {
	Road int     `json:"road"`
	M    float64 `json:"m"`
}
