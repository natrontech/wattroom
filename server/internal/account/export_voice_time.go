package account

// The rider's hangout time (docs/spec/lounge.md): seconds in voice, one
// counter, as the logbook on the cozy room's desk shows it. A crew's time
// together is the crew's, not any one rider's, and stays out.
func (x *export) voiceTime() category {
	return category{"voice-time.json", []string{"user_voice_time"}, func() (any, error) {
		seconds, err := x.q.UserVoiceSeconds(x.ctx, x.user.ID)
		if err != nil {
			return nil, err
		}
		return map[string]any{"secondsInVoice": seconds}, nil
	}}
}
