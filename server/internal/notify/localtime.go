package notify

// Formatting a time for a rider rather than for the server (#858). Everything
// WattRoom mails used to be rendered with startsAt.Local(), which is the zone
// of whatever machine happens to be sending — right only for riders who share
// it, and silently wrong for everybody else.

import "time"

// localTime renders a session's start in the rider's own zone.
//
// Falls back to the server's zone when the rider has none: an account that
// predates #858, or one whose browser has not loaded the app since. That is
// the behaviour every one of these mails had before, so the fallback makes
// nothing worse for anyone — it just stops being the only option.
//
// A name that no longer resolves falls back the same way. The zone database
// is embedded (see main.go), so this can only happen to a name that was valid
// when it was stored and was later retired by IANA; a mail with a slightly
// off time beats no mail at all.
func localTime(t time.Time, zone *string) string {
	if zone != nil && *zone != "" {
		if loc, err := time.LoadLocation(*zone); err == nil {
			return t.In(loc).Format(timeLayout)
		}
	}
	return t.Local().Format(timeLayout)
}

const timeLayout = "Mon 2 Jan, 15:04"
