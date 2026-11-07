package hub

import (
	"context"
	"maps"
	"slices"
	"time"

	"github.com/natrontech/wattroom/server/internal/safego"
)

// VoiceTimeKeeper keeps hangout time (docs/spec/lounge.md): each rider's
// seconds in voice, and each crew's seconds with two or more of its riders in
// one voice channel. Defined here, where it is consumed; channels.VoiceTime
// implements it. AddVoiceTime returns at once, and the implementation writes
// its batches off the hub's locks. Nothing it keeps pays XP or Batzen.
type VoiceTimeKeeper interface {
	// AddVoiceTime credits seconds to each rider named, and to the crew of
	// each voice channel named, once per channel.
	AddVoiceTime(riders, together []string, seconds int)
}

const (
	// voiceTimeEvery is the hangout clock's step, and what each step adds.
	voiceTimeEvery = time.Minute
	// togetherAt is how many riders in one voice channel make its minute the
	// crew's time together.
	togetherAt = 2
)

// KeepVoiceTime runs the hangout clock until ctx ends: once a minute every
// rider in voice gets the minute, and so does the crew of every voice
// channel with two or more of them in it.
func (h *Hub) KeepVoiceTime(ctx context.Context, k VoiceTimeKeeper) {
	safego.Supervise(h.log, h.now, "voice time clock", ctx.Done(), func() { h.runVoiceTime(ctx, k) })
}

// runVoiceTime is the loop behind KeepVoiceTime. It exits when ctx does.
func (h *Hub) runVoiceTime(ctx context.Context, k VoiceTimeKeeper) {
	ticker := time.NewTicker(voiceTimeEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if riders, together := h.voiceMinute(); len(riders) > 0 {
				k.AddVoiceTime(riders, together, int(voiceTimeEvery/time.Second))
			}
		}
	}
}

// voiceMinute is everyone LiveKit reports in voice, once each however many
// channels or tabs, and the voice channels with two or more riders in them.
// Lock, copy, unlock: the keeper is called after.
func (h *Hub) voiceMinute() (riders, together []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	everyone := make(map[string]struct{})
	for channel := range h.voice {
		here := h.voiceRidersLocked(channel)
		if len(here) >= togetherAt {
			together = append(together, channel)
		}
		maps.Copy(everyone, here)
	}
	slices.Sort(together)
	return slices.Sorted(maps.Keys(everyone)), together
}
