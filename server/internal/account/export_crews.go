package account

import (
	"encoding/json"
	"time"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The rider in their crews: where they stand, what they wrote on the board,
// the sessions they rode, planned and answered, the channels they were named
// into and the emoji they added.

func (x *export) sessions() category {
	// No table: a recap names its riders inside the row rather than by a
	// foreign key, so the coverage walk cannot see it and nothing is declared.
	return category{"sessions.json", nil, func() (any, error) {
		// The sessions this rider was present for, and their own interval
		// in each (ADR-0034). Everyone else's interval in the same room is
		// their personal data, not the requester's — the same rule
		// chat.json follows.
		rows, err := x.q.ExportUserRecaps(x.ctx, store.UUIDString(x.user.ID))
		return mapRows(rows, err, func(row db.ExportUserRecapsRow) any {
			return place(map[string]any{
				"workout": row.Workout, "sessionStarted": row.StartedAt.Time,
				"sessionEnded": row.EndedAt.Time,
				"joined":       time.UnixMilli(row.JoinedAt), "left": time.UnixMilli(row.LeftAt),
				"rode": row.Rode}, row.CrewName, row.ChannelName)
		})
	}}
}

func (x *export) plannedSessions() category {
	return category{"planned-sessions.json", []string{"session_rsvps"}, func() (any, error) {
		rows, err := x.q.ExportUserRsvps(x.ctx, x.user.ID)
		return mapRows(rows, err, func(row db.ExportUserRsvpsRow) any {
			// "answeredAt", not "saidYesAt": since #1011 an answer is in
			// or out, and only the absence of one means nothing was said.
			answer := "out"
			if row.Going {
				answer = "in"
			}
			return place(map[string]any{"workoutName": row.WorkoutName,
				"startsAt": row.StartsAt.Time, "answer": answer, "answeredAt": row.CreatedAt.Time},
				row.CrewName, row.ChannelName)
		})
	}}
}

func (x *export) crews() category {
	return x.bounded("crews.json", []string{"crews", "crew_roles"}, func() (any, int, error) {
		// The rider's standing in every crew, and the crews they own
		// (#2089, ADR-0038). One file because it is one object seen from
		// two sides: an owner holds no crew_roles row at all since the
		// 2026-09-08 amendment, so only the union misses neither.
		//
		// `banned` is a standing too, and the one a rider is likeliest to
		// ask about — the crew page 404s for them but the invite door
		// says it to their face, so it is on a screen they have.
		rows, err := x.q.ExportUserCrews(x.ctx, db.ExportUserCrewsParams{
			UserID: x.user.ID, Lim: maxExportRows,
		})
		out, err := mapRows(rows, err, func(row db.ExportUserCrewsRow) any {
			return map[string]any{"name": row.Name, "icon": row.Icon,
				"myRole": row.MyRole, "iOwnIt": row.IOwnIt, "iFoundedIt": row.IFoundedIt,
				"joinedAt": timeOrNil(row.JoinedAt), "roleSetAt": timeOrNil(row.RoleSetAt),
				"createdAt": row.CreatedAt.Time, "renamedAt": timeOrNil(row.RenamedAt),
				// The crew's door. Every member reads it in the app, and
				// it is live — rotating it is what stops an old link.
				"joinCode": row.JoinCode,
				// Her two switches on the membership (#2432), which
				// rooms.json carried per room until M9 moved them here.
				"notify": row.Notify, "onBoard": row.OnBoard}
		})
		return out, len(rows), err
	})
}

func (x *export) pins() category {
	return x.bounded("pins.json", []string{"crew_pins"}, func() (any, int, error) {
		// What the rider wrote on a crew's pin board (ADR-0056, #2863) —
		// their own pins only; the rest of the board is other members'
		// writing, the line chat.json draws.
		rows, err := x.q.ExportUserPins(x.ctx, db.ExportUserPinsParams{
			UserID: x.user.ID, Lim: maxExportRows,
		})
		out, err := mapRows(rows, err, func(row db.ExportUserPinsRow) any {
			return map[string]any{"crew": row.CrewName, "title": row.Title, "body": row.Body,
				"createdAt": row.CreatedAt.Time, "updatedAt": row.UpdatedAt.Time}
		})
		return out, len(rows), err
	})
}

func (x *export) scheduledSessions() category {
	return x.bounded("sessions-i-scheduled.json", []string{"scheduled_sessions"}, func() (any, int, error) {
		// The sessions the rider PUT ON a calendar (#2089), which is not
		// the set planned-sessions.json holds: that one is their RSVPs, so
		// a coach who schedules every week and never says yes to their own
		// session exported nothing at all. The workout comes with it —
		// they wrote it into the plan, and it is what the room was asked
		// to ride.
		rows, err := x.q.ExportUserScheduledSessions(x.ctx, db.ExportUserScheduledSessionsParams{
			UserID: x.user.ID, Lim: maxExportRows,
		})
		out, err := mapRows(rows, err, func(row db.ExportUserScheduledSessionsRow) any {
			return place(map[string]any{
				"workoutName": row.WorkoutName, "startsAt": row.StartsAt.Time,
				"plannedAt": row.CreatedAt.Time, "startedAt": timeOrNil(row.StartedAt),
				"workout": json.RawMessage(row.WorkoutJson)},
				row.CrewName, row.ChannelName)
		})
		return out, len(rows), err
	})
}

func (x *export) channelMembers() category {
	return x.bounded("channel-members.json", []string{"channel_members"}, func() (any, int, error) {
		// Being named into a private channel (ADR-0058, #2554), the
		// successor of room-doors.json and both directions for its reason:
		// the channels that name the rider, and the people they named
		// into one — by display name, never an id or an address.
		rows, err := x.q.ExportUserChannelMembers(x.ctx, db.ExportUserChannelMembersParams{
			UserID: x.user.ID, Lim: maxExportRows,
		})
		out, err := mapRows(rows, err, func(row db.ExportUserChannelMembersRow) any {
			one := map[string]any{"direction": row.Direction, "crew": row.CrewName,
				"channel": row.ChannelName, "kind": row.Kind, "at": row.AddedAt.Time}
			if row.Rider != "" {
				one["rider"] = row.Rider
			}
			return one
		})
		return out, len(rows), err
	})
}

func (x *export) emoji() category {
	return x.bounded("emoji.json", []string{"crew_emoji"}, func() (any, int, error) {
		// The emoji the rider added to their crews (#2643): the name they
		// typed, and the crew and emoji ids that name the picture — it is
		// served at /api/crews/{crewId}/emoji/{emoji}. Rows only, for
		// images.json's reason: each picture is capped, but the crews a
		// rider is in are not, so their total is not (ADR-0053).
		rows, err := x.q.ExportUserCrewEmoji(x.ctx, db.ExportUserCrewEmojiParams{
			UserID: x.user.ID, Lim: maxExportRows,
		})
		out, err := mapRows(rows, err, func(row db.ExportUserCrewEmojiRow) any {
			return map[string]any{"name": row.Name, "emoji": store.UUIDString(row.ID),
				"crew": row.CrewName, "crewId": store.UUIDString(row.CrewID),
				"mime": row.Mime, "sizeBytes": row.SizeBytes, "uploadedAt": row.CreatedAt.Time}
		})
		return out, len(rows), err
	})
}
