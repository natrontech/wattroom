package rooms

import (
	"context"
	"math"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/stats"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Reading rooms: the rail's list, one room's page, and the cooperative
// numbers a room shows its members. Split from rooms.go (#1265).

func (s *Service) handleMine(w http.ResponseWriter, r *http.Request) {
	user, ok := s.users.RequireUser(w, r, "Not signed in.")
	if !ok {
		return
	}
	roomsList, err := s.store.Queries.ListUserRooms(r.Context(), user.ID)
	if err != nil {
		httpx.Fail(w, s.log, "list rooms failed", err, "Your rooms could not be loaded.")
		return
	}
	out := make([]roomJSON, 0, len(roomsList))
	for _, room := range roomsList {
		// The palette rides the list (#468): a thread read from outside the
		// room reacts in the room's own vocabulary without opening the room —
		// which handleGet would count as reading it.
		entry := roomJSON{ID: store.UUIDString(room.ID), Slug: room.Slug, Name: room.Name, Listed: room.Listed,
			Icon: room.Icon, Role: room.Role, Cheers: cheerSet(room.Cheers)}
		entry.MemberCount = int(room.MemberCount)
		entry.Access = accessOf(room.CrewVisible, true, false)
		// The sidebar groups by this (ADR-0038, and #1023's option C). Absent
		// while crew_id is still nullable, which is one release only.
		if room.CrewID.Valid {
			entry.Crew = &roomCrewJSON{
				Id: store.UUIDString(room.CrewID), Name: room.CrewName, Icon: room.CrewIcon,
				ImageURL: crewImageURL(room.CrewID, room.CrewHasImage), Code: room.CrewCode,
				Role: crewRoleWord(room.CrewOwned, room.CrewAdmin),
			}
		}
		if s.presence != nil {
			entry.RoomPresence = s.presence.Presence(room.Slug)
		}
		// Standing in a room is reading it: a badge on the room you are looking
		// at is noise, and handleGet has already stamped it read. By id, not
		// by display name — two riders called Dave used to silence each
		// other's badge (#649). The count is already in hand; what is
		// conditional is whether it is worth showing.
		if !slices.Contains(entry.RiderIDs, store.UUIDString(user.ID)) {
			entry.Unread = int(room.Unread)
		}
		// The timestamp is the "is there one" answer for both of these: the
		// lateral joins are LEFT, and their text columns coalesce to empty.
		if room.NextStartsAt.Valid {
			entry.NextSession = &nextJSON{
				WorkoutName: room.NextWorkoutName,
				StartsAt:    room.NextStartsAt.Time.Format(time.RFC3339),
			}
		}
		if room.LastChatAt.Valid {
			entry.LastChat = &lastChatJSON{
				From: room.LastChatFrom, Text: room.LastChatText, HasImage: room.LastChatImageID.Valid,
				At: room.LastChatAt.Time.UnixMilli(),
			}
		}
		out = append(out, entry)
	}
	// The crew's rooms you are NOT in (#1149): open ones you could walk into,
	// private ones you can see exist, and ones you administer without
	// reading. Name, icon, crew and state — no presence and no counts, since
	// every live signal is members-only and these are rooms you never joined.
	others, err := s.store.Queries.ListCrewRoomsFor(r.Context(), user.ID)
	if err != nil {
		httpx.Fail(w, s.log, "list crew rooms failed", err, "Your rooms could not be loaded.")
		return
	}
	for _, room := range others {
		slug, access := doorOf(room)
		out = append(out, roomJSON{
			ID: store.UUIDString(room.ID), Slug: slug, Name: room.Name, Icon: room.Icon, Access: access,
			Crew: &roomCrewJSON{
				Id: store.UUIDString(room.CrewID), Name: room.CrewName, Icon: room.CrewIcon,
				ImageURL: crewImageURL(room.CrewID, room.CrewHasImage), Code: room.CrewCode,
				Role: crewRoleWord(room.CrewOwnerID == user.ID, room.Administers),
			},
		})
	}
	// The crews in their own right (#1476): a crew with no rooms is still a
	// crew, and a client that only knew crews through rooms lost it.
	crewRows, err := s.store.Queries.ListCrewsFor(r.Context(), user.ID)
	if err != nil {
		httpx.Fail(w, s.log, "list crews failed", err, "Your rooms could not be loaded.")
		return
	}
	crews := make([]roomCrewJSON, 0, len(crewRows))
	for _, c := range crewRows {
		crews = append(crews, roomCrewJSON{
			Id: store.UUIDString(c.ID), Name: c.Name, Icon: c.Icon,
			ImageURL: crewImageURL(c.ID, c.HasImage), Code: c.Code,
			Role: crewRoleWord(c.Owned, c.Admin), Named: c.Named, Founded: c.Founded,
		})
	}
	// maxOwned rides the list so the frontend gates on the server's number
	// instead of its own copy (#603) — a hint that disagrees with what the
	// POST will do is worse than no hint.
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"rooms": out, "crews": crews, "maxOwned": maxOwnedRooms})
}

// handleGet renders differently by membership: members get everything (the
// code is the invite, so it stays inside the room); anyone else with the link
// gets just enough to decide to join. Metrics privacy is not at stake here —
// nothing live crosses this endpoint.
// together reads what the room's members did together. Soft-fails to nil like
// the streak and month-kJ reads beside it: a stats query that cannot answer is
// a tile that does not render, never a room that will not open.
func (s *Service) together(ctx context.Context, roomID, viewer pgtype.UUID) *togetherJSON {
	totals, err := s.store.Queries.RoomCrewTotals(ctx, roomID)
	if err != nil {
		return nil
	}
	out := &togetherJSON{
		Seconds:           totals.Seconds,
		SessionsThisMonth: totals.SessionsThisMonth,
		SessionsLastMonth: totals.SessionsLastMonth,
	}
	days, err := s.store.Queries.ListRoomSessionDays(ctx, db.ListRoomSessionDaysParams{
		RoomID: roomID, ViewerID: viewer,
	})
	if err != nil {
		return out
	}
	// Oldest first: the strip reads left to right like every other timeline.
	out.Attended = make([]bool, len(days))
	for i, day := range days {
		out.Attended[len(days)-1-i] = day.Attended
	}
	return out
}

// board reads this week's ordered board. Only called when the room has turned
// it on; soft-fails to nil like every other stats read beside it.
func (s *Service) board(ctx context.Context, roomID pgtype.UUID) []boardRowJSON {
	rows, err := s.store.Queries.RoomWeekBoard(ctx, roomID)
	if err != nil {
		return nil
	}
	out := make([]boardRowJSON, 0, len(rows))
	for _, row := range rows {
		// SPEC defines FTP as 0.95 x the 90-day best 20-minute power, so the
		// bracket reads off the FTP the room already publishes rather than
		// querying rides this room cannot see.
		best20m := int(math.Round(float64(row.FtpWatts) / 0.95))
		out = append(out, boardRowJSON{
			Id: store.UUIDString(row.UserID), DisplayName: row.DisplayName,
			Kj: row.Kj, Seconds: row.Seconds,
			Category: stats.Category(best20m, float64(row.WeightKg)),
		})
	}
	return out
}

func (s *Service) handleGet(w http.ResponseWriter, r *http.Request) {
	room, ok := s.roomBySlug(w, r)
	if !ok {
		return
	}
	response := roomJSON{Slug: room.Slug, Name: room.Name, Listed: room.Listed, Icon: room.Icon}

	if user, signedIn := s.users.User(r); signedIn {
		// The outsider's two facts (#1236): whether the door opens for them,
		// and whether they are at least in the room's crew.
		banned := s.isBanned(r, room, user)
		if can, err := s.store.Queries.CanEnterRoom(r.Context(), db.CanEnterRoomParams{UserID: user.ID, RoomID: room.ID}); err == nil {
			response.CanEnter = can && !banned
		}
		// The third fact (audit 2026-09-09): a removed rider's door used to
		// send them for an invite link that would be refused, or offer a
		// Join that always failed. A ban survives the code (docs/SPEC.md),
		// so saying so gives nothing away.
		response.Banned = banned
		if room.CrewID.Valid {
			if role, err := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: room.CrewID, UserID: user.ID}); err == nil {
				response.InCrew = role != "" && role != "banned"
			}
		}
		// A banned viewer gets the outsider view — the join button tells them.
		if m, err := s.store.Queries.GetMembership(r.Context(), db.GetMembershipParams{
			RoomID: room.ID, UserID: user.ID,
		}); err == nil && m.Role != "banned" && !s.isBanned(r, room, user) {
			response.Role = m.Role
			response.Me = &riderPrefsJSON{Notify: m.Notify, OnBoard: m.OnBoard}
			// Opening the room is reading it (#389): the badge clears here, so
			// the rail stops shouting about a room you are standing in.
			if err := s.store.Queries.MarkRoomRead(r.Context(), db.MarkRoomReadParams{
				RoomID: room.ID, UserID: user.ID,
			}); err != nil {
				s.log.Warn("mark room read failed", "err", err, "room", room.Slug)
			}
			response.SoundPack = room.SoundPack
			response.Cheers = cheerSet(room.Cheers)
			response.IcsToken = room.IcsToken
			rows, err := s.store.Queries.ListRoomUpcoming(r.Context(), room.ID)
			if err != nil {
				// Loudly, like the members below: an empty list here drew "plan
				// the first session" over a room that had five (audit 2026-09-09).
				httpx.Fail(w, s.log, "list upcoming failed", err, "The room could not be loaded.", "room", room.Slug)
				return
			}
			// Who is in, for every plan at once (#450) — one query, not
			// one per session.
			going := map[string][]goingJSON{}
			if yes, err := s.store.Queries.ListRoomRsvps(r.Context(), room.ID); err == nil {
				for _, row := range yes {
					id := store.UUIDString(row.SessionID)
					going[id] = append(going[id], goingJSON{
						ID: store.UUIDString(row.UserID), DisplayName: row.DisplayName,
					})
				}
			} else {
				s.log.Warn("list rsvps failed", "err", err, "room", room.Slug)
			}
			for _, row := range rows {
				id := store.UUIDString(row.ID)
				response.Upcoming = append(response.Upcoming, scheduledJSON{
					ID: id, WorkoutName: row.WorkoutName,
					WorkoutJSON: string(row.WorkoutJson),
					StartsAt:    row.StartsAt.Time.Format(time.RFC3339), CreatedBy: row.CreatedBy,
					Going: going[id],
				})
			}
			members, err := s.store.Queries.ListRoomMembers(r.Context(), room.ID)
			if err != nil {
				httpx.Fail(w, s.log, "list members failed", err, "The room could not be loaded.", "room", room.Slug)
				return
			}
			// Which banned rows are also crew-banned (#1150), owner-only like
			// the ban list itself. One query, not one per row.
			// Every medal this room awarded, per rider (#1371): the roster's
			// count. A failure here is a row with no count, not a failed page.
			medalCount := map[pgtype.UUID]int32{}
			if rows, err := s.store.Queries.CountRoomMedalsByRider(r.Context(), room.ID); err == nil {
				for _, row := range rows {
					medalCount[row.UserID] = row.Medals
				}
			} else {
				s.log.Warn("count medals failed", "err", err, "room", room.Slug)
			}
			crewBanned := map[pgtype.UUID]bool{}
			if m.Role == "owner" && room.CrewID.Valid {
				if ids, err := s.store.Queries.ListCrewBans(r.Context(), room.CrewID); err == nil {
					for _, id := range ids {
						crewBanned[id] = true
					}
				}
			}
			for _, member := range members {
				// The ban list is a moderation surface, not roster gossip —
				// only the owner sees who is out.
				if member.Role == "banned" && m.Role != "owner" {
					continue
				}
				response.Members = append(response.Members, memberJSON{
					ID: store.UUIDString(member.ID), DisplayName: member.DisplayName,
					AvatarURL: member.AvatarUrl,
					Role:      member.Role, TotalXp: member.TotalXp,
					FtpWatts: member.FtpWatts, WeightKg: member.WeightKg,
					JoinedAt:   member.JoinedAt.Time.Format("2006-01-02"),
					Medals:     int(medalCount[member.ID]),
					Badges:     member.Badges,
					CrewBanned: member.Role == "banned" && crewBanned[member.ID],
				})
			}
			if m.Role == "owner" && room.CrewID.Valid && !room.CrewVisible {
				response.Invited, response.CrewOutside = s.exceptions(r.Context(), room, user, members)
			}
			if weeks, err := s.store.Queries.ListRoomRideWeeks(r.Context(), room.ID); err == nil {
				times := make([]time.Time, len(weeks))
				for i, w := range weeks {
					times[i] = w.Time
				}
				// UTC, deliberately: this is the ROOM's streak, and a room
				// whose riders sit in several zones has no one week to use
				// (#2063). The rider streak that pays is in stats.StreakXP.
				response.StreakWeeks = stats.WeekStreak(times, time.Now(), time.UTC)
			}
			if kj, err := s.store.Queries.RoomMonthKj(r.Context(), room.ID); err == nil {
				response.MonthKj = kj
			}
			response.Together = s.together(r.Context(), room.ID, user.ID)
			// The crew, for members only and on the same rule as the code and
			// the sound pack: a room's members are in its crew, and someone
			// outside this room may be outside the crew, whose name is then
			// not theirs to read. Soft-fails to absent like the reads
			// above — a crew that cannot be looked up is a switcher entry that
			// does not render, never a room that will not open.
			if room.CrewID.Valid {
				if crew, err := s.store.Queries.GetCrew(r.Context(), room.CrewID); err == nil {
					role, _ := s.store.Queries.CrewRoleOf(r.Context(), db.CrewRoleOfParams{CrewID: crew.ID, UserID: user.ID})
					response.Crew = &roomCrewJSON{
						Id: store.UUIDString(crew.ID), Name: crew.Name, Icon: crew.Icon, Role: role,
						ImageURL: crewImageURL(crew.ID, crew.HasImage), Code: codeOf(crew.Code),
					}
					// Whether deleting this room takes the crew with it
					// (#1935) — asked only of the room's owner, since only
					// they can delete it and only their confirm says so.
					// Soft-fails to absent like the reads above: an unanswered
					// query is a confirm without the extra line, never a room
					// that will not open.
					if m.Role == "owner" {
						if goes, err := s.store.Queries.CrewGoesWithRoom(r.Context(), db.CrewGoesWithRoomParams{
							CrewID: crew.ID, RoomID: room.ID,
						}); err == nil {
							response.Crew.GoesWithRoom = goes
						} else {
							s.log.Warn("crew goes-with-room check failed", "err", err, "room", room.Slug)
						}
					}
				}
			}
			response.CrewVisible = room.CrewVisible
			if room.BoardEnabled {
				response.Board = s.board(r.Context(), room.ID)
			}
			medals, err := s.store.Queries.ListRoomMedals(r.Context(), db.ListRoomMedalsParams{
				RoomID: room.ID, Limit: 24,
			})
			if err == nil {
				for _, medal := range medals {
					response.Medals = append(response.Medals, medalJSON{
						Kind: medal.Kind, Rider: medal.DisplayName, RiderID: store.UUIDString(medal.UserID),
						AwardedAt:   medal.AwardedAt.Time.Format("2006-01-02"),
						AwardedAtMs: medal.AwardedAt.Time.UnixMilli(),
					})
				}
			}
		}
		// Whether this room keeps a weekly board — a member's own setting, and
		// since #1651 the door's fourth fact too. ADR-0036 requires the board
		// be turned on "visibly — what the room shares is fixed and legible
		// *before* anyone is inside it"; set inside the members-only block
		// above, it meant walking in published the joiner's week with the door
		// never having said a board existed. Only the fact travels: the rows
		// stay behind the membership, and it reaches only a rider the door
		// would let in, because ADR-0039's asymmetry keeps what anybody else
		// reads about a room as narrow as it already was.
		if !banned && (response.Role != "" || response.CanEnter || room.Listed) {
			response.BoardEnabled = room.BoardEnabled
		}
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}

// PublicIdentity is what a link preview may say about a room (#1734): its
// name and icon when the owner listed it, nothing otherwise. ADR-0039:
// "public" means every signed-in rider, not the web — and the share card
// answers crawlers and strangers with no session at all.
func (s *Service) PublicIdentity(ctx context.Context, slug string) (name, icon string, ok bool) {
	room, err := s.store.Queries.GetRoomBySlug(ctx, slug)
	if err != nil || !room.Listed {
		return "", "", false
	}
	return room.Name, room.Icon, true
}
