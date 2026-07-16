// Package protocol defines the WebSocket message types. These Go structs are
// the single source of truth; `make protocol` generates the TypeScript types
// via tygo (see WATTROOM.md decisions: WS protocol).
package protocol

// RiderMetrics is one rider's live sample, sent client -> server at ~1 Hz.
type RiderMetrics struct {
	Watts   int `json:"watts"`
	HR      int `json:"hr,omitempty"`
	Cadence int `json:"cadence,omitempty"`
	Seq     int `json:"seq"` // monotonic per ride, for reconnect dedup
}

// ClientMessage is the envelope for everything a client sends.
type ClientMessage struct {
	Metrics *RiderMetrics `json:"metrics,omitempty"`
}

// ServerTick is the coalesced 1 Hz room broadcast: every rider's latest sample.
type ServerTick struct {
	At     int64                   `json:"at"` // unix millis
	Riders map[string]RiderMetrics `json:"riders"`
}
