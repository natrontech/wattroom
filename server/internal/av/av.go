// Package av mints LiveKit access tokens (#21). AV is transit-only and never
// recorded (locked privacy decision) — the server's only AV job is saying who
// may join which LiveKit room, which it answers with the same membership check
// that gates the metrics socket.
package av

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
)

// Access is the same authorization the hub consumes — one membership door for
// metrics and AV alike.
type Access interface {
	Authorize(r *http.Request, slug string) (protocol.Rider, error)
}

type Config struct {
	URL    string
	Key    string
	Secret string
}

// FromEnv reads WATTROOM_LIVEKIT_{URL,KEY,SECRET}. Nothing set means no AV:
// the endpoint is not mounted and the web hides the controls (capability
// gating) rather than offering a call that cannot connect.
func FromEnv() (Config, bool) {
	cfg := Config{
		URL:    os.Getenv("WATTROOM_LIVEKIT_URL"),
		Key:    os.Getenv("WATTROOM_LIVEKIT_KEY"),
		Secret: os.Getenv("WATTROOM_LIVEKIT_SECRET"),
	}
	return cfg, cfg.URL != "" && cfg.Key != "" && cfg.Secret != ""
}

type Service struct {
	cfg    Config
	access Access
	log    *slog.Logger
	now    func() time.Time
	voice  VoiceSink
}

func New(cfg Config, access Access, log *slog.Logger) *Service {
	return &Service{cfg: cfg, access: access, log: log, now: time.Now}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/rooms/{slug}/av-token", s.handleToken)
}

func (s *Service) handleToken(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	rider, err := s.access.Authorize(r, slug)
	if err != nil {
		httpx.WriteError(w, http.StatusForbidden, "forbidden",
			"Voice and camera are for the room's members.")
		return
	}
	token, err := s.mint(slug, rider)
	if err != nil {
		s.log.Error("av token mint failed", "err", err, "room", slug)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"The call could not be set up. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"url":   s.cfg.URL,
		"token": token,
	})
}

// videoGrant is LiveKit's claim shape — only the fields we use.
type videoGrant struct {
	Room         string `json:"room"`
	RoomJoin     bool   `json:"roomJoin"`
	CanPublish   bool   `json:"canPublish"`
	CanSubscribe bool   `json:"canSubscribe"`
}

type claims struct {
	Iss   string     `json:"iss"`
	Sub   string     `json:"sub"`
	Name  string     `json:"name"`
	Nbf   int64      `json:"nbf"`
	Exp   int64      `json:"exp"`
	Video videoGrant `json:"video"`
}

// mint builds the LiveKit JWT by hand: HS256 over two base64url JSON blobs is
// ~30 lines of stdlib, against the livekit/protocol module's whole tree
// (stdlib-first is the locked rule; the claim shape is pinned by test).
func (s *Service) mint(slug string, rider protocol.Rider) (string, error) {
	now := s.now()
	header := map[string]string{"alg": "HS256", "typ": "JWT"}
	payload := claims{
		Iss:  s.cfg.Key,
		Sub:  rider.ID,
		Name: rider.Name,
		Nbf:  now.Unix(),
		// Long enough for any session; the membership check happens at mint.
		Exp: now.Add(6 * time.Hour).Unix(),
		Video: videoGrant{
			Room: slug, RoomJoin: true, CanPublish: true, CanSubscribe: true,
		},
	}
	enc := func(v any) (string, error) {
		raw, err := json.Marshal(v)
		if err != nil {
			return "", err
		}
		return base64.RawURLEncoding.EncodeToString(raw), nil
	}
	head, err := enc(header)
	if err != nil {
		return "", err
	}
	body, err := enc(payload)
	if err != nil {
		return "", err
	}
	signing := head + "." + body
	mac := hmac.New(sha256.New, []byte(s.cfg.Secret))
	mac.Write([]byte(signing))
	return signing + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}
