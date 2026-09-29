package account

import (
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// What the rider said and to whom: their channel lines, their DM threads,
// their friends, and what they reacted with and pasted in.

func (x *export) chat() category {
	return category{"chat.json", []string{"chat_messages"}, func() (any, error) {
		rows, err := x.q.ExportUserChat(x.ctx, x.user.ID)
		return mapRows(rows, err, func(row db.ExportUserChatRow) any {
			// The edit and the picture (#2089): messages.json has carried
			// both for DMs since #1819 and chat.json carried neither, so
			// an edited line exported as if it had always read that way
			// and a picture-only line exported as an empty string.
			line := place(map[string]any{"text": row.Text, "at": row.CreatedAt.Time},
				row.CrewName, row.ChannelName)
			if row.ImageID.Valid {
				line["imageId"] = store.UUIDString(row.ImageID)
			}
			if row.EditedAt.Valid {
				line["editedAt"] = row.EditedAt.Time
			}
			return line
		})
	}}
}

func (x *export) messages() category {
	return category{"messages.json", []string{"dm_messages"}, func() (any, error) {
		rows, err := x.q.ExportUserDms(x.ctx, x.user.ID)
		return mapRows(rows, err, func(row db.ExportUserDmsRow) any {
			// A picture line exports its id and the edit its time (#1819):
			// an image-only message used to export as an empty line.
			line := map[string]any{"with": row.PeerName, "fromMe": row.SentByMe,
				"text": row.Text, "at": row.CreatedAt.Time}
			if row.ImageID.Valid {
				line["imageId"] = store.UUIDString(row.ImageID)
			}
			if row.EditedAt.Valid {
				line["editedAt"] = row.EditedAt.Time
			}
			return line
		})
	}}
}

func (x *export) friends() category {
	return category{"friends.json", []string{"friendships"}, func() (any, error) {
		rows, err := x.q.ExportUserFriends(x.ctx, x.user.ID)
		return mapRows(rows, err, func(row db.ExportUserFriendsRow) any {
			return map[string]any{"name": row.PeerName, "iAsked": row.IAsked,
				"status": row.Status, "since": row.CreatedAt.Time}
		})
	}}
}

func (x *export) dismissedRequests() category {
	return category{"dismissed-requests.json", []string{"friend_declines"}, func() (any, error) {
		// The asks of mine that were dismissed (ADR-0012 amendment): told
		// to me, so mine to take along (#1654).
		rows, err := x.q.ExportUserFriendDeclines(x.ctx, x.user.ID)
		return mapRows(rows, err, func(row db.ExportUserFriendDeclinesRow) any {
			return map[string]any{"name": row.DisplayName, "at": row.DeclinedAt.Time}
		})
	}}
}

func (x *export) hiddenRiders() category {
	return category{"hidden-riders.json", []string{"rider_blocks"}, func() (any, error) {
		// The riders I hid (#3202): mine to see in Settings, by name. Who
		// hid me is theirs — the one thing the block never tells.
		rows, err := x.q.ExportUserHiddenRiders(x.ctx, x.user.ID)
		return mapRows(rows, err, func(row db.ExportUserHiddenRidersRow) any {
			return map[string]any{"name": row.DisplayName, "since": row.CreatedAt.Time}
		})
	}}
}

func (x *export) reactions() category {
	return x.bounded("reactions.json", []string{"chat_reactions", "dm_reactions"}, func() (any, int, error) {
		// The emoji the rider put on things other people wrote (#2089):
		// their own, on a room line and in a DM, which the app draws as
		// the ring around a cheer they are in on. Two reads into one
		// file, because it is one act on two surfaces.
		//
		// A reaction is theirs; the line under it may not be. So a row
		// locates the line by the moment it was written — lining up with
		// chat.json and messages.json — and carries the TEXT only where
		// the rider is entitled to it: their own room line, or any line
		// of a DM thread messages.json already carries whole.
		chat, err := x.q.ExportUserChatReactions(x.ctx, db.ExportUserChatReactionsParams{
			UserID: x.user.ID, Lim: maxExportRows,
		})
		if err != nil {
			return nil, 0, err
		}
		dms, err := x.q.ExportUserDmReactions(x.ctx, db.ExportUserDmReactionsParams{
			UserID: x.user.ID, Lim: maxExportRows,
		})
		if err != nil {
			return nil, 0, err
		}
		out := make([]any, 0, len(chat)+len(dms))
		for _, row := range chat {
			one := place(map[string]any{"on": "channel",
				"place": row.ChannelName, "emoji": row.Emoji,
				"lineAt": row.LineAt.Time, "onMyOwnLine": row.OnMyOwnLine},
				row.CrewName, row.ChannelName)
			if row.OnMyOwnLine {
				one["line"] = row.Line
			}
			out = append(out, one)
		}
		for _, row := range dms {
			out = append(out, map[string]any{"on": "dm", "place": row.PeerName,
				"emoji": row.Emoji, "lineAt": row.LineAt.Time,
				"onMyOwnLine": row.OnMyOwnLine, "line": row.Line})
		}
		// Whichever read hit the bound cut this file short, so the larger
		// of the two decides — not the sum, which would call a file
		// truncated that neither bound touched.
		return out, max(len(chat), len(dms)), nil
	})
}

func (x *export) images() category {
	return x.bounded("images.json", []string{"chat_images", "dm_images"}, func() (any, int, error) {
		// The pictures the rider pasted into a room and sent in a DM
		// (#2090). chat.json and messages.json have carried the image
		// id on the line since #2089 and #1819 and nothing resolved it,
		// so the archive named files it neither described nor contained.
		// Two reads into one file, the way reactions.json holds one act
		// on two surfaces.
		//
		// The BYTES are not here, and this and emoji.json are the
		// omissions left in the archive: a rider's pictures have no
		// per-rider ceiling the way their clips do (docs/SPEC.md's
		// MaxRiderBytes), and the zip is built whole in memory (#1990).
		// That is a limit of the archive's shape, not a judgement about
		// the files — ADR-0053 — and they follow when the build streams.
		chat, err := x.q.ExportUserChatImages(x.ctx, db.ExportUserChatImagesParams{
			UserID: x.user.ID, Lim: maxExportRows,
		})
		if err != nil {
			return nil, 0, err
		}
		dms, err := x.q.ExportUserDmImages(x.ctx, db.ExportUserDmImagesParams{
			UserID: x.user.ID, Lim: maxExportRows,
		})
		if err != nil {
			return nil, 0, err
		}
		out := make([]any, 0, len(chat)+len(dms))
		for _, row := range chat {
			out = append(out, place(map[string]any{"on": "channel",
				"place": row.ChannelName, "image": store.UUIDString(row.ID),
				"mime": row.Mime, "sizeBytes": row.SizeBytes,
				"uploadedAt": row.CreatedAt.Time, "stillOnALine": row.StillOnALine},
				row.CrewName, row.ChannelName))
		}
		for _, row := range dms {
			out = append(out, map[string]any{"on": "dm", "place": row.PeerName,
				"image": store.UUIDString(row.ID), "mime": row.Mime,
				"sizeBytes": row.SizeBytes, "uploadedAt": row.CreatedAt.Time,
				"stillOnALine": row.StillOnALine})
		}
		// The larger read decides, not the sum — reactions.json's rule,
		// and for its reason: a sum calls a file truncated that neither
		// bound touched.
		return out, max(len(chat), len(dms)), nil
	})
}
