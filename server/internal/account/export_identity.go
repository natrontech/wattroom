package account

import (
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/natrontech/wattroom/server/internal/auth"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// The rider's own row and the ways they sign in: profile.json, and the
// credentials, tokens and picture hung off the account.

// profile is the users row as a person reads it. Written before every
// category, and the one read that sinks the export when it fails.
func (x *export) profile() (map[string]any, error) {
	user := x.user
	// The crew the rider chose as home (#2863), by name: an id is not
	// something a person reads. Null when unset.
	var homeCrew any
	if user.HomeCrewID.Valid {
		crew, err := x.q.GetCrew(x.ctx, user.HomeCrewID)
		if err != nil {
			return nil, err
		}
		homeCrew = crew.Name
	}
	// The hashes are not here and must not be: email_verify_hash and
	// recover_hash are SHA-256 of a token we never stored, so there is
	// nothing to hand back, and a hash of a live credential is the one thing
	// an export should not carry.
	return map[string]any{
		"displayName": user.DisplayName,
		"ftpWatts":    user.FtpWatts,
		"weightKg":    user.WeightKg,
		// And where each of those came from (#1484): the export claims
		// Art. 15's scope, so it carries the row — a file saying 200 W
		// without saying nobody chose it is the same half-truth Home used
		// to tell.
		"ftpSource":     user.FtpSource,
		"weightSource":  user.WeightSource,
		"createdAt":     user.CreatedAt.Time,
		"email":         user.Email,
		"notifyPlanned": user.NotifyPlanned,
		"accentPalette": user.AccentPalette,
		"colorScheme":   user.ColorScheme,
		// The rest of what the row holds about the rider (#1826): their own
		// LTHR, the timezone the app observed, the Strava switch, and when
		// the address was verified. The export claims Art. 15's scope; it
		// has to carry the row.
		"lthr":            user.Lthr,
		"timezone":        user.Timezone,
		"stravaUpload":    user.StravaUpload,
		"emailVerifiedAt": timeOrNil(user.EmailVerifiedAt),
		// The last five columns a rider can see and could not take (#2089):
		// the code they hand friends, the address a confirmation link is
		// still owed to, and their avatar.
		"friendCode":   user.FriendCode,
		"emailPending": user.EmailPending,
		"avatarUrl":    user.AvatarUrl,
		// Two of them are live links rather than facts — the calendar feed
		// any app can subscribe to, and the one-click unsubscribe at the foot
		// of our mail. They are data we hold about the rider and Art. 15
		// carries them, but a zip holding them is a zip worth keeping to
		// yourself, which is what the privacy page now says.
		"calendarToken":    user.IcsToken,
		"unsubscribeToken": store.UUIDString(user.UnsubToken),
		// The reactions they picked (#2722), as the icons they react with.
		"cheers": auth.CheerSet(user.Cheers),
		// The last of the row (#2863): the crew the sidebar opens in, the
		// invite they were sent and have not taken up (Home offers it back),
		// and whether the account had to confirm an address before it rode.
		"homeCrew":      homeCrew,
		"pendingInvite": user.PendingCrewCode,
		"emailRequired": user.EmailRequired,
		// The status the rider wrote (ADR-0060), as the row holds it — one
		// already cleared included, since nothing sweeps the columns.
		"status": map[string]any{
			"emoji": user.StatusEmoji,
			// Whether that emoji is drawn as a crew's own picture — which the
			// row points at by id, and which emoji.json names if it is theirs.
			"emojiIsCrewPicture": user.StatusEmojiID.Valid,
			"text":               user.StatusText,
			"expiresAt":          timeOrNil(user.StatusExpiresAt),
		},
	}, nil
}

func (x *export) identities() category {
	return category{"identities.json", []string{"identities"}, func() (any, error) {
		// The credential set (#1826): the privacy page says the provider
		// user id is kept, so the export carries it; never a token.
		rows, err := x.q.ExportUserIdentities(x.ctx, x.user.ID)
		return mapRows(rows, err, func(row db.ExportUserIdentitiesRow) any {
			return map[string]any{"provider": row.Provider, "providerUserId": row.ProviderUserID,
				"connectedAt": row.CreatedAt.Time}
		})
	}}
}

func (x *export) passkeys() category {
	return category{"passkeys.json", []string{"passkeys"}, func() (any, error) {
		// The public half only: the rider's name for each, added, last used.
		rows, err := x.q.ExportUserPasskeys(x.ctx, x.user.ID)
		return mapRows(rows, err, func(row db.ExportUserPasskeysRow) any {
			return map[string]any{"name": row.Name, "addedAt": row.CreatedAt.Time,
				"lastUsedAt": timeOrNil(row.LastUsedAt)}
		})
	}}
}

func (x *export) coachAccess() category {
	return x.bounded("coach-access.json", []string{"api_tokens"}, func() (any, int, error) {
		// The read-only tokens the rider minted for a coach or an MCP
		// client (#2089, ADR-0017), listed on Settings → Data and never
		// exported. The name, the day it was made and the day it was
		// last used — never the token: it was shown once at creation and
		// we keep only its hash, so there is nothing here to hand back.
		rows, err := x.q.ExportUserApiTokens(x.ctx, db.ExportUserApiTokensParams{
			UserID: x.user.ID, Lim: maxExportRows,
		})
		out, err := mapRows(rows, err, func(row db.ExportUserApiTokensRow) any {
			return map[string]any{"name": row.Name, "createdAt": row.CreatedAt.Time,
				"lastUsedAt": timeOrNil(row.LastUsedAt)}
		})
		return out, len(rows), err
	})
}

func (x *export) avatar() category {
	return category{"avatar.json", []string{"user_avatars"}, func() (any, error) {
		// The picture the rider uploaded, and uploads/avatar.* beside it
		// (#2090). profile.json carries `avatarUrl`, which is the address
		// it is served at — an address is not the picture, and a rider
		// taking their data somewhere else cannot fetch it from a server
		// they have just left.
		//
		// Their own photograph, so ADR-0015's fence — "metadata is; files
		// are re-uploadable", written about somebody else's recording —
		// has nothing to say about it, and Art. 15(3) asks for a copy of
		// the data rather than a description of it.
		//
		// No row is not a failure: a rider who never uploaded one keeps
		// whatever their sign-in provider drew, which lives on that
		// provider's host and was never ours to hand over (#2078).
		avatar, err := x.q.GetUserAvatar(x.ctx, x.user.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		x.avatarFile.name = "uploads/avatar" + imageExt(avatar.Mime)
		x.avatarFile.bytes = avatar.Image
		return map[string]any{"mime": avatar.Mime, "sizeBytes": len(avatar.Image),
			"setAt": avatar.SetAt.Time, "file": x.avatarFile.name}, nil
	}}
}
