package av

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

// VoiceSink is what the webhook feeds — implemented by the hub, defined here
// where it is consumed. Who is in voice, per room, before anyone enters.
type VoiceSink interface {
	VoiceJoined(slug, identity, name string)
	VoiceLeft(slug, identity string)
	VoiceRoomClosed(slug string)
	// Camera on/off (#251) — track_published/track_unpublished, CAMERA source.
	VoiceCamera(slug, identity, name string, on bool)
	// The reconciler's two ends (#234): which rooms to ask LiveKit about,
	// and its authoritative participant list applied back.
	VoiceRooms() []string
	VoiceSync(slug string, present map[string]string, since time.Time)
}

// SetVoiceSink wires the hub in after construction (same late-binding shape
// as rooms.SetPresence, for the same construction-order reason).
func (s *Service) SetVoiceSink(sink VoiceSink) { s.voice = sink }

// RegisterWebhook mounts LiveKit's event callback. Separate from Register so
// main can mount it only when a sink exists.
func (s *Service) RegisterWebhook(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/livekit/webhook", s.handleWebhook)
}

// webhookEvent is LiveKit's payload — only the fields the radar needs.
type webhookEvent struct {
	Event string `json:"event"`
	Room  struct {
		Name string `json:"name"`
	} `json:"room"`
	Participant struct {
		Identity string `json:"identity"`
		Name     string `json:"name"`
	} `json:"participant"`
	Track struct {
		Source string `json:"source"` // "CAMERA" | "MICROPHONE" | "SCREEN_SHARE"
	} `json:"track"`
}

// handleWebhook verifies LiveKit's signature and updates the voice map.
// LiveKit authenticates with the same HS256 JWT scheme the tokens use: the
// Authorization header carries a JWT whose `sha256` claim is the base64 of
// the body's SHA-256 — verify the signature, then the hash, then believe
// the body. Same ~30 stdlib lines as mint(), same locked stdlib-first rule.
func (s *Service) handleWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if !s.verifyWebhook(r.Header.Get("Authorization"), body) {
		s.log.Warn("livekit webhook rejected", "remote", r.RemoteAddr)
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	var event webhookEvent
	if err := json.Unmarshal(body, &event); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if s.voice != nil {
		switch event.Event {
		case "participant_joined":
			s.voice.VoiceJoined(event.Room.Name, event.Participant.Identity, event.Participant.Name)
		case "participant_left":
			s.voice.VoiceLeft(event.Room.Name, event.Participant.Identity)
		case "track_published", "track_unpublished":
			if event.Track.Source == "CAMERA" {
				s.voice.VoiceCamera(event.Room.Name, event.Participant.Identity,
					event.Participant.Name, event.Event == "track_published")
			}
		case "room_finished":
			s.voice.VoiceRoomClosed(event.Room.Name)
		}
	}
	w.WriteHeader(http.StatusOK)
}

func (s *Service) verifyWebhook(authHeader string, body []byte) bool {
	parts := strings.Split(strings.TrimSpace(authHeader), ".")
	if len(parts) != 3 {
		return false
	}
	signing := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(s.cfg.Secret))
	mac.Write([]byte(signing))
	want := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(parts[2])) {
		return false
	}
	var claims struct {
		Iss    string `json:"iss"`
		Exp    int64  `json:"exp"`
		Sha256 string `json:"sha256"`
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || json.Unmarshal(payload, &claims) != nil {
		return false
	}
	if claims.Iss != s.cfg.Key || time.Now().Unix() > claims.Exp {
		return false
	}
	sum := sha256.Sum256(body)
	// LiveKit base64-encodes the hash with standard encoding.
	return claims.Sha256 == base64.StdEncoding.EncodeToString(sum[:])
}
