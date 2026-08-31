package av

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// The voice radar is fed by LiveKit webhooks alone, and a hard-crashed
// LiveKit never says goodbye — after a restart it has no memory of its rooms,
// so stale identities would sit in the hub's voice map forever (#234). Once a
// minute, ask LiveKit who is actually in each voiced room and let the hub
// prune the ghosts (and heal any join a lost webhook missed).

// StartReconciler runs the sweep until ctx ends.
// ponytail: process-lifetime goroutine — the server has no shutdown context.
func (s *Service) StartReconciler(ctx context.Context) {
	go func() { // exits on ctx.Done
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.reconcile(ctx)
			}
		}
	}()
}

func (s *Service) reconcile(ctx context.Context) {
	if s.voice == nil {
		return
	}
	for _, slug := range s.voice.VoiceRooms() {
		since := s.now()
		present, ok := s.listParticipants(ctx, slug)
		if !ok {
			continue // LiveKit unreachable — a blip must not wipe the radar
		}
		s.voice.VoiceSync(slug, present, since)
	}
}

// listParticipants asks LiveKit who is in the room right now. A 404 is an
// answer — the room doesn't exist, nobody is in it. Anything else unhealthy
// means "don't know": the caller keeps current state.
func (s *Service) listParticipants(ctx context.Context, slug string) (map[string]string, bool) {
	resp, err := s.roomAPI(ctx, "ListParticipants", slug, map[string]string{"room": slug})
	if err != nil {
		s.log.Warn("voice reconcile call failed", "err", err, "room", slug)
		return nil, false
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusNotFound {
		return map[string]string{}, true
	}
	if resp.StatusCode != http.StatusOK {
		s.log.Warn("voice reconcile refused", "status", resp.StatusCode, "room", slug)
		return nil, false
	}
	var out struct {
		Participants []struct {
			Identity string `json:"identity"`
			Name     string `json:"name"`
		} `json:"participants"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		s.log.Warn("voice reconcile decode failed", "err", err, "room", slug)
		return nil, false
	}
	present := make(map[string]string, len(out.Participants))
	for _, p := range out.Participants {
		present[p.Identity] = p.Name
	}
	return present, true
}
