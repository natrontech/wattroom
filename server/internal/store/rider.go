package store

import (
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// RiderOf is the part of a roster entry the users row answers: who, the two
// numbers, where they came from and when the weight last moved (#3169), and
// what they wear in the cozy room.
// The door and a mid-session profile save both build it here, so a race
// reads the same numbers whichever put them on the roster.
func RiderOf(u db.User) protocol.Rider {
	r := protocol.Rider{
		ID:                UUIDString(u.ID),
		Name:              u.DisplayName,
		FtpWatts:          int(u.FtpWatts),
		WeightKg:          int(u.WeightKg),
		FtpSource:         protocol.SourceOf(u.FtpSource),
		WeightSource:      protocol.SourceOf(u.WeightSource),
		WeightChangedAt:   Millis(u.WeightChangedAt),
		WeightConfirmedAt: Millis(u.WeightConfirmedAt),
	}
	if u.LoungeLook != nil {
		r.LoungeLook = *u.LoungeLook
	}
	return r
}
