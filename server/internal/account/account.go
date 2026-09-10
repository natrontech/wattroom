// Package account is export-all and delete (#35): the two ends of the locked
// privacy promise. Export hands the rider everything as a zip; delete purges
// the account and lets the schema's cascades take rides (sample blobs and the
// heart rate inside them — ADR-0008), sessions, identities, memberships and
// medals with it, structurally rather than by cleanup job.
package account

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/rooms"
	"github.com/natrontech/wattroom/server/internal/safego"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// maxExportRows bounds every category a rider can run up on purpose — the
// music shelf first (#1089), and since #2089 the soundboard, the reactions,
// the coach tokens, the crews, the sessions they scheduled, the rooms they
// own, the doors they opened and the ride deliveries. Each of those is
// created a row at a time by a person, and the quotas that bound them bound
// BYTES (ADR-0015's 2 GB of audio, SPEC's 100 MB of clips) or bound only the
// upcoming half (fifty planned sessions per room, but the past keeps
// accruing) — so the row count is what this route cannot let grow without
// end. One number for all of them because the reasoning is the same one and
// ten thousand rows is past every real account in every one of them: a shelf
// that long averages a track under 200 KB, and nobody has ten thousand
// crews. The manifest says which category a bound bit rather than letting it
// go quietly short.
//
// A var rather than a const because the test that proves the manifest says
// "truncated" lowers it: a guard against a quietly short export that no test
// has ever seen bite is not a guard.
var maxExportRows int32 = 10000

// category is one file in the archive and the read that fills it. Named
// because bounded() below builds them too (#2089).
type category struct {
	name string
	rows func() (any, error)
}

// Sessions is what account needs from auth: who is asking, and the ability to
// end their session after the purge.
type Sessions interface {
	RequireUser(w http.ResponseWriter, r *http.Request, signInMessage string) (db.User, bool)
}

// Alerter is what account needs from notify: the receipt for a purge (#840,
// ADR-0030). Absent — no mail capability on this server — the deletion simply
// goes unannounced, the same capability gating the rest of the app uses.
type Alerter interface {
	AccountDeleted(user db.User)
}

// CrewReleaser is what the purge needs from rooms (ADR-0038, second
// amendment): crews.owner_id is ON DELETE RESTRICT, so every crew the rider
// owns is handed on or removed before the row goes. Inside the purge's own
// transaction, so a transfer that fails leaves the account exactly as it was.
type CrewReleaser interface {
	ReleaseCrews(ctx context.Context, q *db.Queries, user pgtype.UUID) error
}

// GrantRevoker hands a third-party grant back — the seam auth uses for a
// disconnect (server/internal/strava). A purge that dropped our row while
// Strava still listed the app told the rider something untrue (#1825).
type GrantRevoker interface {
	RevokeGrant(ctx context.Context, ident db.Identity) error
}

type Service struct {
	store    *store.Store
	sessions Sessions
	log      *slog.Logger
	alerter  Alerter
	crews    CrewReleaser
	revoker  GrantRevoker
	reaper   BlobReaper
	// One export in flight per account (#1554). inflight.go.
	exports *inFlight
}

// SetStravaRevoker wires the uploader in after construction, like SetCrews.
// Absent, a delete still purges the row.
func (s *Service) SetStravaRevoker(r GrantRevoker) { s.revoker = r }

// BlobReaper takes uploaded audio off disk once no row points at it (#1897).
type BlobReaper interface {
	RemoveBlobs(shas []string)
}

// SetTrackReaper wires the tracks service in after construction, like the rest.
func (s *Service) SetTrackReaper(r BlobReaper) { s.reaper = r }

func New(st *store.Store, sessions Sessions, log *slog.Logger) *Service {
	return &Service{store: st, sessions: sessions, log: log, exports: newInFlight()}
}

// SetAlerter wires the notify capability in after construction, the shape
// auth.SetMailer already uses.
func (s *Service) SetAlerter(a Alerter) { s.alerter = a }

// SetCrews wires the crew hand-over in; without it a rider who owns a crew
// cannot be purged, which the RESTRICT makes loud rather than silent.
func (s *Service) SetCrews(c CrewReleaser) { s.crews = c }

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/me/export", s.handleExport)
	mux.HandleFunc("DELETE /api/me", s.handleDelete)
}

// handleExport streams a zip of everything WattRoom holds about the rider —
// an export they can open, not a database dump they cannot.
//
// The scope is not a product choice (#696). Two rights apply and they differ:
//
//   - Access — GDPR Art. 15, revFADP Art. 25 — covers everything the
//     controller holds about the person, including what we derived (XP,
//     trophies). No machine-readable format is required, only an intelligible
//     one; the deadline is one month (GDPR Art. 12(3)) / 30 days (FADP
//     Art. 25(7)).
//   - Portability — GDPR Art. 20, revFADP Art. 28 — is narrower: data the
//     rider PROVIDED, processed automatically on consent or a contract, and it
//     must be "structured, commonly used and machine-readable". WP29's
//     WP242rev.01 reads "provided" as covering observed data (what they did
//     here), not inferred data.
//
// This export satisfies both by being the wider one in the stricter format:
// every category below as indented JSON in a zip, served immediately.
//
// Third-party data is the hard part, and the rule here is: EXPORT ONLY WHAT
// THE RIDER CAN ALREADY SEE IN THE APP, attributed by display name and
// nothing else. GDPR Art. 20(4) says the right "shall not adversely affect
// the rights and freedoms of others", and WP29 warns equally against reading
// that so strictly that anything touching another person is withheld. So:
// their own room-chat lines but not the room's (someone else's line is that
// person's data, not theirs); whole DM threads, which are as much about them
// as about the peer and which they can already read; a friend's display name
// but never their email, id, or a single watt of anyone else's ride.
//
// Three things are left out on purpose, and saying so here is the point:
// an omission nobody wrote down is the failure this route exists to prevent.
//
//   - The AUDIO a rider uploaded — pool tracks (#1089) and soundboard clips
//     (#2089). Their ROWS are here in full: the titles, artists, albums,
//     tags, names, pads and trims they typed are theirs under Art. 15 and are
//     exactly "what the rider can already see". The files are not.
//     ADR-0015's copyright fence allows no public share links to audio files
//     and the ADR settled the same question for backups ("metadata is; files
//     are re-uploadable"), and neither a 2 GB shelf nor 100 MB of clips can
//     go into an archive this route builds whole in memory. Each row names
//     its file — a track by its content address, a clip by the id it is
//     served under — so nothing about the omission is silent. The bytes of
//     the other things a rider uploads (avatars, clips, chat and DM pictures)
//     are #2090.
//   - The auth `sessions` table: a hash of a cookie, with no screen anywhere
//     that lists a rider's live sessions. There is nothing here to hand back
//     that would mean anything, and handing back session material is not an
//     improvement.
//   - `room_reads` and `track_plays`, which are the same judgement twice:
//     bookkeeping attributable to the rider that no screen shows them.
//     room_reads is an unread-marker cursor. track_plays is read back only as
//     a ROOM's last five titles, the same five for everyone in it, with no
//     date and no per-rider view — so a dated, cross-room list of everything
//     the rider ever queued would be strictly more than they can see, which
//     is the line this export stops at. If a "what I put on" surface ever
//     ships, this is the category to add with it.
//
// Not legal advice — a lawyer should confirm the reading before it is relied
// on. The provisions are cited so the next person can check rather than
// re-derive.
func (s *Service) handleExport(w http.ResponseWriter, r *http.Request) {
	user, ok := s.sessions.RequireUser(w, r, "Sign in to export your data.")
	if !ok {
		return
	}
	// The ceiling (#1554): one export in flight per account. Below, this
	// handler reads and gunzips every ride blob the rider owns, so the thing
	// worth refusing is a second copy of that running beside the first — a
	// double-click, or a second tab. After RequireUser, so a slot is only ever
	// held against a known account and a signed-out caller cannot take one.
	if !s.exports.acquire(user.ID) {
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			"Your export is already being built. Wait for it to finish, then ask again.")
		return
	}
	// Every return below gives the slot back, and so does a panic on the way
	// out: an entry left behind would lock this rider out of their own data
	// until the next restart, which is a worse bug than the one the ceiling
	// fixes.
	defer s.exports.release(user.ID)

	rides, err := s.store.Queries.ListUserRidesFull(r.Context(), user.ID)
	if err != nil {
		httpx.Fail(w, s.log, "export query failed", err, "The export could not be built. Try again.")
		return
	}

	// Built whole before the first byte goes out (#1990): a zip header already
	// on the wire turns every later failure into a 200 with a silent, short
	// archive — on the one route where "everything we hold" being short is
	// the failure that matters. ponytail: the whole archive sits in memory;
	// it is deflated JSON, a season's samples are a few MB, and #894's
	// one-blob-at-a-time read still bounds the working set.
	var buf bytes.Buffer
	archive := zip.NewWriter(&buf)
	fail := func(what string, err error) {
		httpx.Fail(w, s.log, what, err, "The export could not be built. Try again.", "user", store.UUIDString(user.ID))
	}
	writeJSON := func(name string, v any) bool {
		f, err := archive.Create(name)
		if err == nil {
			enc := json.NewEncoder(f)
			enc.SetIndent("", "  ")
			err = enc.Encode(v)
		}
		if err != nil {
			fail("export write "+name, err)
			return false
		}
		return true
	}

	profile := map[string]any{
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
	}
	// The hashes are not here and must not be: email_verify_hash and
	// recover_hash are SHA-256 of a token we never stored, so there is
	// nothing to hand back, and a hash of a live credential is the one thing
	// an export should not carry.
	if !writeJSON("profile.json", profile) {
		return
	}

	// Every column the ride page shows (#1550): the export's scope is what
	// the rider can already see, and four of these were missing.
	summaries := make([]map[string]any, 0, len(rides))
	for _, ride := range rides {
		var normWatts any
		if ride.NormWatts != nil {
			normWatts = *ride.NormWatts
		}
		summaries = append(summaries, map[string]any{
			"workoutName":     ride.WorkoutName,
			"startedAt":       ride.StartedAt.Time,
			"seconds":         ride.Seconds,
			"avgWatts":        ride.AvgWatts,
			"normWatts":       normWatts,
			"kj":              ride.Kj,
			"execution":       ride.Execution,
			"executionScored": ride.ExecutionScored,
			"ftpWatts":        ride.FtpWatts,
			// The number a ramp test produced (ADR-0049, #2089): the ride
			// page shows it and the export did not, so the one ride that
			// moved the rider's FTP read like any other.
			"ftpAfterWatts":     ride.FtpAfterWatts,
			"xp":                ride.Xp,
			"inARoom":           ride.RoomID.Valid,
			"sharedWithFriends": ride.SharedAt.Valid,
			"curve":             json.RawMessage(ride.Curve),
		})
	}
	if !writeJSON("rides.json", summaries) {
		return
	}

	// What went in and what did not (#1550): a category whose read failed is
	// left out rather than sinking the export, and the manifest, written
	// last, says which.
	type entry struct {
		Name string `json:"name"`
		Ok   bool   `json:"ok"`
		// Set when a bounded category held more rows than its bound (#1089):
		// a category that is short without saying so is the silent omission
		// this whole route exists to avoid.
		Truncated bool `json:"truncated,omitempty"`
	}
	manifest := []entry{{Name: "profile.json", Ok: true}, {Name: "rides.json", Ok: true}}
	// Filled by a bounded category, read into its manifest entry below.
	truncated := map[string]bool{}

	// bounded declares a category read under maxExportRows: the rider gets
	// the bound's worth and manifest.json says the category was cut short
	// when the bound bit. The read hands back how many rows it saw, so a
	// category's name, its bound and the note about it are written once and
	// cannot drift apart — the drift being what would make an export go
	// quietly short again.
	bounded := func(name string, read func() (any, int, error)) category {
		return category{name, func() (any, error) {
			out, n, err := read()
			if err == nil && n >= int(maxExportRows) {
				truncated[name] = true
			}
			return out, err
		}}
	}

	// Everything else the account holds (#696). One query per category, each
	// user-scoped and each mapped to the keys a person reads rather than the
	// column names a database uses — this is a file the rider opens. A
	// category that fails to read loses itself, not the export: someone
	// entitled to their data should get what we could gather, not a 500.
	for _, cat := range []category{
		{"chat.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserChat(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserChatRow) any {
				// The edit and the picture (#2089): messages.json has carried
				// both for DMs since #1819 and chat.json carried neither, so
				// an edited line exported as if it had always read that way
				// and a picture-only line exported as an empty string.
				line := map[string]any{"room": row.RoomName, "roomSlug": row.RoomSlug,
					"text": row.Text, "at": row.CreatedAt.Time}
				if row.ImageID.Valid {
					line["imageId"] = store.UUIDString(row.ImageID)
				}
				if row.EditedAt.Valid {
					line["editedAt"] = row.EditedAt.Time
				}
				return line
			})
		}},
		{"messages.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserDms(r.Context(), user.ID)
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
		}},
		{"sessions.json", func() (any, error) {
			// The sessions this rider was present for, and their own interval
			// in each (ADR-0034). Everyone else's interval in the same room is
			// their personal data, not the requester's — the same rule
			// chat.json follows.
			rows, err := s.store.Queries.ExportUserRecaps(r.Context(), store.UUIDString(user.ID))
			return mapRows(rows, err, func(row db.ExportUserRecapsRow) any {
				return map[string]any{"room": row.RoomName, "roomSlug": row.RoomSlug,
					"workout": row.Workout, "sessionStarted": row.StartedAt.Time,
					"sessionEnded": row.EndedAt.Time,
					"joined":       time.UnixMilli(row.JoinedAt), "left": time.UnixMilli(row.LeftAt),
					"rode": row.Rode}
			})
		}},
		{"friends.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserFriends(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserFriendsRow) any {
				return map[string]any{"name": row.PeerName, "iAsked": row.IAsked,
					"status": row.Status, "since": row.CreatedAt.Time}
			})
		}},
		{"dismissed-requests.json", func() (any, error) {
			// The asks of mine that were dismissed (ADR-0012 amendment): told
			// to me, so mine to take along (#1654).
			rows, err := s.store.Queries.ExportUserFriendDeclines(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserFriendDeclinesRow) any {
				return map[string]any{"name": row.DisplayName, "at": row.DeclinedAt.Time}
			})
		}},
		{"playlists.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserPlaylists(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserPlaylistsRow) any {
				return map[string]any{"name": row.Name, "createdAt": row.CreatedAt.Time,
					"tracks": json.RawMessage(row.Tracks)}
			})
		}},
		bounded("tracks.json", func() (any, int, error) {
			// The music the rider uploaded (#1089): the rows of their own
			// shelf, which since #1095 is exactly the part of the pool they
			// can see. Every field they typed, plus what the file measured,
			// plus the content address so a row still names its file.
			//
			// Never the audio. ADR-0015's copyright fence has no public share
			// links to audio files, and the ADR already answered this for
			// backups — "metadata is; files are re-uploadable, so v1 excludes
			// them" — which is the same question with the same answer. It is
			// also the only version that stays inside the export's shape:
			// this archive is built whole in memory and a shelf is 2 GB.
			rows, err := s.store.Queries.ExportUserTracks(r.Context(), db.ExportUserTracksParams{
				UploadedBy: user.ID, Lim: maxExportRows,
			})
			out, err := mapRows(rows, err, func(row db.ExportUserTracksRow) any {
				var bpm any
				if row.Bpm != nil {
					bpm = *row.Bpm
				}
				return map[string]any{"title": row.Title, "artist": row.Artist,
					"album": row.Album, "tags": row.Tags, "bpm": bpm,
					"durationMs": row.DurationMs, "sizeBytes": row.SizeBytes,
					"uploadedAt": row.CreatedAt.Time, "contentAddress": row.Sha256}
			})
			return out, len(rows), err
		}),
		{"planned-sessions.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserRsvps(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserRsvpsRow) any {
				return map[string]any{"room": row.RoomName, "workoutName": row.WorkoutName,
					"startsAt": row.StartsAt.Time, "saidYesAt": row.CreatedAt.Time}
			})
		}},
		{"rooms.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserRooms(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserRoomsRow) any {
				// The two choices the rider made in the room (#2089), both
				// on its settings screen and neither exported: whether it
				// may mail them, and whether they stand on its weekly board.
				return map[string]any{"name": row.Name, "slug": row.Slug,
					"role": row.Role, "joinedAt": row.JoinedAt.Time,
					"notify": row.Notify, "onBoard": row.OnBoard}
			})
		}},
		{"workouts.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserWorkouts(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserWorkoutsRow) any {
				return map[string]any{"name": row.Name, "author": row.Author,
					"createdAt": row.CreatedAt.Time, "workout": json.RawMessage(row.Definition)}
			})
		}},
		{"xp.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserXp(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserXpRow) any {
				return map[string]any{"amount": row.Amount, "source": row.Source,
					"about": row.Ref, "at": row.At.Time}
			})
		}},
		{"trophies.json", func() (any, error) {
			rows, err := s.store.Queries.ExportUserAchievements(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserAchievementsRow) any {
				return map[string]any{"trophy": row.Key, "earnedAt": row.EarnedAt.Time}
			})
		}},
		{"identities.json", func() (any, error) {
			// The credential set (#1826): the privacy page says the provider
			// user id is kept, so the export carries it; never a token.
			rows, err := s.store.Queries.ExportUserIdentities(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserIdentitiesRow) any {
				return map[string]any{"provider": row.Provider, "providerUserId": row.ProviderUserID,
					"connectedAt": row.CreatedAt.Time}
			})
		}},
		{"passkeys.json", func() (any, error) {
			// The public half only: the rider's name for each, added, last used.
			rows, err := s.store.Queries.ExportUserPasskeys(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserPasskeysRow) any {
				return map[string]any{"name": row.Name, "addedAt": row.CreatedAt.Time,
					"lastUsedAt": timeOrNil(row.LastUsedAt)}
			})
		}},
		bounded("coach-access.json", func() (any, int, error) {
			// The read-only tokens the rider minted for a coach or an MCP
			// client (#2089, ADR-0017), listed on Settings → Data and never
			// exported. The name, the day it was made and the day it was
			// last used — never the token: it was shown once at creation and
			// we keep only its hash, so there is nothing here to hand back.
			rows, err := s.store.Queries.ExportUserApiTokens(r.Context(), db.ExportUserApiTokensParams{
				UserID: user.ID, Lim: maxExportRows,
			})
			out, err := mapRows(rows, err, func(row db.ExportUserApiTokensRow) any {
				return map[string]any{"name": row.Name, "createdAt": row.CreatedAt.Time,
					"lastUsedAt": timeOrNil(row.LastUsedAt)}
			})
			return out, len(rows), err
		}),
		bounded("reactions.json", func() (any, int, error) {
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
			chat, err := s.store.Queries.ExportUserChatReactions(r.Context(), db.ExportUserChatReactionsParams{
				UserID: user.ID, Lim: maxExportRows,
			})
			if err != nil {
				return nil, 0, err
			}
			dms, err := s.store.Queries.ExportUserDmReactions(r.Context(), db.ExportUserDmReactionsParams{
				UserID: user.ID, Lim: maxExportRows,
			})
			if err != nil {
				return nil, 0, err
			}
			out := make([]any, 0, len(chat)+len(dms))
			for _, row := range chat {
				one := map[string]any{"on": "room", "place": row.RoomName,
					"roomSlug": row.RoomSlug, "emoji": row.Emoji,
					"lineAt": row.LineAt.Time, "onMyOwnLine": row.OnMyOwnLine}
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
		}),
		bounded("crews.json", func() (any, int, error) {
			// The rider's standing in every crew, and the crews they own
			// (#2089, ADR-0038). One file because it is one object seen from
			// two sides: an owner holds no crew_roles row at all since the
			// 2026-09-08 amendment, so only the union misses neither.
			//
			// `banned` is a standing too, and the one a rider is likeliest to
			// ask about — the crew page 404s for them but the invite door
			// says it to their face, so it is on a screen they have.
			rows, err := s.store.Queries.ExportUserCrews(r.Context(), db.ExportUserCrewsParams{
				UserID: user.ID, Lim: maxExportRows,
			})
			out, err := mapRows(rows, err, func(row db.ExportUserCrewsRow) any {
				return map[string]any{"name": row.Name, "icon": row.Icon,
					"myRole": row.MyRole, "iOwnIt": row.IOwnIt, "iFoundedIt": row.IFoundedIt,
					"joinedAt": timeOrNil(row.JoinedAt), "roleSetAt": timeOrNil(row.RoleSetAt),
					"createdAt": row.CreatedAt.Time, "renamedAt": timeOrNil(row.RenamedAt),
					// The crew's door. Every member reads it in the app, and
					// it is live — rotating it is what stops an old link.
					"joinCode": row.JoinCode}
			})
			return out, len(rows), err
		}),
		bounded("sessions-i-scheduled.json", func() (any, int, error) {
			// The sessions the rider PUT ON a calendar (#2089), which is not
			// the set planned-sessions.json holds: that one is their RSVPs, so
			// a coach who schedules every week and never says yes to their own
			// session exported nothing at all. The workout comes with it —
			// they wrote it into the plan, and it is what the room was asked
			// to ride.
			rows, err := s.store.Queries.ExportUserScheduledSessions(r.Context(), db.ExportUserScheduledSessionsParams{
				UserID: user.ID, Lim: maxExportRows,
			})
			out, err := mapRows(rows, err, func(row db.ExportUserScheduledSessionsRow) any {
				return map[string]any{"room": row.RoomName, "roomSlug": row.RoomSlug,
					"workoutName": row.WorkoutName, "startsAt": row.StartsAt.Time,
					"plannedAt": row.CreatedAt.Time, "startedAt": timeOrNil(row.StartedAt),
					"workout": json.RawMessage(row.WorkoutJson)}
			})
			return out, len(rows), err
		}),
		bounded("rooms-i-own.json", func() (any, int, error) {
			// The room rows the rider owns (#2089). rooms.json says they are
			// a member of it; this says what they configured, which is the
			// whole of the room settings screen — and the calendar link off
			// the room's sessions page, which no other file carries.
			//
			// This is also where the sound pack lives. #2089 filed it as a
			// column on users; it is a room's setting and always was.
			rows, err := s.store.Queries.ExportUserOwnedRooms(r.Context(), db.ExportUserOwnedRoomsParams{
				UserID: user.ID, Lim: maxExportRows,
			})
			out, err := mapRows(rows, err, func(row db.ExportUserOwnedRoomsRow) any {
				return map[string]any{"name": row.Name, "slug": row.Slug,
					"crew": row.CrewName, "createdAt": row.CreatedAt.Time,
					"listed": row.Listed, "crewVisible": row.CrewVisible,
					"boardEnabled": row.BoardEnabled, "soundPack": row.SoundPack,
					"icon": row.Icon,
					// The icons the room actually speaks, not the stored
					// string: empty means the stock set, and rooms.CheerSet
					// is the one place that rule is written.
					"cheers":          rooms.CheerSet(row.Cheers),
					"autoplayEnabled": row.AutoplayEnabled,
					"autoplayOrder":   row.AutoplayOrder,
					"calendarToken":   row.IcsToken}
			})
			return out, len(rows), err
		}),
		bounded("room-doors.json", func() (any, int, error) {
			// Named exceptions into a private room (#2089, ADR-0038 #1224): a
			// door, not a membership — the person still walks in themselves,
			// and the grant is moot once they do.
			//
			// Both directions, because both are the rider's: the doors opened
			// FOR them, and the doors THEY opened as a room's owner. The
			// second names other people, and it names them the way the
			// owner's own door list does and by nothing else — a display
			// name, never an id or an address.
			rows, err := s.store.Queries.ExportUserRoomDoors(r.Context(), db.ExportUserRoomDoorsParams{
				UserID: user.ID, Lim: maxExportRows,
			})
			out, err := mapRows(rows, err, func(row db.ExportUserRoomDoorsRow) any {
				one := map[string]any{"direction": row.Direction, "room": row.RoomName,
					"roomSlug": row.RoomSlug, "at": row.GrantedAt.Time}
				if row.Rider != "" {
					one["rider"] = row.Rider
				}
				return one
			})
			return out, len(rows), err
		}),
		bounded("soundboard.json", func() (any, int, error) {
			// The soundboard the rider built (#2089): every clip in their
			// library, the name they typed, the pad and key they bound it to,
			// and the trim they set — what ClipsFace draws, which is what
			// they see.
			//
			// Rows in, AUDIO OUT, the reading ADR-0015 settled for uploaded
			// music and #2081 applied to tracks.json: "metadata is; files are
			// re-uploadable". It is also the only version that fits — SPEC's
			// per-rider ceiling is 100 MB of clips and this archive is built
			// whole in memory. A clip is served by its id and nothing else,
			// so the id comes along and a row still names its file. The bytes
			// are #2090.
			rows, err := s.store.Queries.ExportUserBoardClips(r.Context(), db.ExportUserBoardClipsParams{
				UserID: user.ID, Lim: maxExportRows,
			})
			out, err := mapRows(rows, err, func(row db.ExportUserBoardClipsRow) any {
				return map[string]any{"clip": store.UUIDString(row.ID), "name": row.Name,
					"pad": row.Pad, "key": row.Key, "durationMs": row.DurationMs,
					"sizeBytes": row.SizeBytes, "startMs": row.StartMs, "endMs": row.EndMs,
					"gainDb": row.GainDb, "fadeInMs": row.FadeInMs, "fadeOutMs": row.FadeOutMs,
					"uploadedAt": row.CreatedAt.Time}
			})
			return out, len(rows), err
		}),
		bounded("ride-uploads.json", func() (any, int, error) {
			// Where each ride was sent and whether it arrived (#2089, #799):
			// the ride page says "On Strava as …", or waiting, or failed, and
			// none of it was in the archive — so a rider whose upload had
			// been failing for a month exported no trace of it.
			//
			// The bookkeeping is ours: destination, state, attempts, the error
			// our uploader recorded and the two timestamps are all about a
			// ride WE recorded and sent. The remote activity number is the one
			// field Strava handed back, and Strava's own API Policy is what
			// permits it here — §2.3 and §5.4 allow their data to be shown to
			// that athlete, which is exactly and only what this route does.
			// AGENTS.md's firewall is about LLM and agent features; an
			// authenticated zip to the account's owner is neither.
			//
			// The ride is named by its start, the way medals.json names one,
			// so a row lines up with rides.json without a uuid having to mean
			// something outside this database.
			rows, err := s.store.Queries.ExportUserRideDeliveries(r.Context(), db.ExportUserRideDeliveriesParams{
				UserID: user.ID, Lim: maxExportRows,
			})
			out, err := mapRows(rows, err, func(row db.ExportUserRideDeliveriesRow) any {
				return map[string]any{"destination": row.Destination, "state": row.State,
					"attempts": row.Attempts, "lastError": row.LastError,
					"remoteActivityId": row.RemoteID, "workoutName": row.WorkoutName,
					"rideStartedAt": row.RideStartedAt.Time,
					"firstTriedAt":  row.CreatedAt.Time, "lastMovedAt": row.UpdatedAt.Time}
			})
			return out, len(rows), err
		}),
		{"medals.json", func() (any, error) {
			// Shown on the ride and rider pages, purged with the account —
			// and never exported until #1550.
			rows, err := s.store.Queries.ExportUserMedals(r.Context(), user.ID)
			return mapRows(rows, err, func(row db.ExportUserMedalsRow) any {
				return map[string]any{"medal": row.Kind, "room": row.RoomName,
					"rideStartedAt": row.RideStartedAt.Time, "awardedAt": row.AwardedAt.Time}
			})
		}},
	} {
		rows, err := cat.rows()
		if err != nil {
			s.log.Error("export category failed", "category", cat.name, "err", err)
			manifest = append(manifest, entry{Name: cat.name, Ok: false})
			continue
		}
		if !writeJSON(cat.name, rows) {
			return
		}
		manifest = append(manifest, entry{Name: cat.name, Ok: true, Truncated: truncated[cat.name]})
	}

	// One blob at a time: read, stream into the zip, let it go. Held together
	// in one slice, a rider's whole history is in memory at once — and that
	// number grows every month they keep riding (#894).
	samplesWritten := 0
	for _, ride := range rides {
		blob, err := s.store.Queries.GetRideSamples(r.Context(), db.GetRideSamplesParams{
			ID: ride.ID, UserID: user.ID,
		})
		if err != nil {
			continue // one unreadable ride loses its samples, not the export
		}
		name := fmt.Sprintf("samples/%s-%s.json",
			ride.StartedAt.Time.UTC().Format("2006-01-02-1504"), store.UUIDString(ride.ID)[:8])
		f, err := archive.Create(name)
		if err != nil {
			fail("export write "+name, err)
			return
		}
		zr, err := gzip.NewReader(bytes.NewReader(blob))
		if err != nil {
			continue // a corrupt blob loses one ride's samples, not the export
		}
		// The blob was written by us and is size-bounded at write time; copy is fine.
		_, _ = io.Copy(f, zr) //nolint:gosec // own bounded data
		_ = zr.Close()
		samplesWritten++
	}
	if !writeJSON("manifest.json", map[string]any{
		"generatedAt": time.Now().UTC(),
		"categories":  manifest,
		"samples":     map[string]int{"rides": len(rides), "written": samplesWritten},
		"complete": samplesWritten == len(rides) &&
			!slices.ContainsFunc(manifest, func(e entry) bool { return !e.Ok || e.Truncated }),
	}) {
		return
	}
	if err := archive.Close(); err != nil {
		fail("export close", err)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf("attachment; filename=%q", "wattroom-export-"+time.Now().UTC().Format("2006-01-02")+".zip"))
	w.Header().Set("Content-Length", strconv.Itoa(buf.Len()))
	_, _ = w.Write(buf.Bytes())
}

// handleDelete is the purge. The confirmation lives client-side (a typed
// phrase); the server's job is to be certain who is asking and delete once.
func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	user, ok := s.sessions.RequireUser(w, r, "Sign in first.")
	if !ok {
		return
	}
	// Read before the purge: after it the row is gone and there is nothing
	// left to hand back. The privacy page promises a full purge, and WattRoom
	// listed on the rider's Strava for ever was not one (#1825).
	strava, err := s.store.Queries.GetUserIdentity(r.Context(), db.GetUserIdentityParams{UserID: user.ID, Provider: "strava"})
	hasStrava := err == nil
	orphans, err := s.purge(r.Context(), user.ID)
	if err != nil {
		httpx.Fail(w, s.log, "account delete failed", err, "The deletion did not complete. Nothing was removed — try again.")
		return
	}
	// Log the fact, never the identity details: the account is gone.
	s.log.Info("account deleted", "user", store.UUIDString(user.ID))
	// The rider's uploaded audio goes with them (#1897): the cascade took the
	// rows, and the blobs only they pointed at come off disk after the commit.
	// A file another rider also holds stays — one blob per sha (#1095).
	if s.reaper != nil && len(orphans) > 0 {
		s.reaper.RemoveBlobs(orphans)
	}
	// The grant goes back after the commit, detached and best-effort, the
	// disconnect's own posture: Strava being down must not fail a deletion
	// that already happened, and a failure is a warning, never a rider.
	if hasStrava && s.revoker != nil {
		revoker, ident := s.revoker, strava
		safego.Go(s.log, "strava revoke after delete", func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := revoker.RevokeGrant(ctx, ident); err != nil {
				s.log.Warn("strava grant not revoked upstream after delete", "err", err)
			}
		})
	}
	// The receipt goes to the address on the row read before the purge — after
	// it there is no row, and the mail would have no recipient. Fire-and-forget
	// inside notify, so a mail provider cannot fail a deletion that already
	// committed.
	if s.alerter != nil {
		s.alerter.AccountDeleted(user)
	}
	w.WriteHeader(http.StatusNoContent)
}

// purge is the delete, in one transaction: the rider's own rooms first
// (explicitly, so the crews they own are judged by the rooms that remain),
// then every crew they own is handed on or removed, then the row — and the
// schema's cascades take the rest as before.
// Returns the content addresses of uploaded audio that only this rider's
// rows pointed at (#1897), read before the rows go, for the caller to take
// off disk once the commit holds.
func (s *Service) purge(ctx context.Context, user pgtype.UUID) ([]string, error) {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.store.Queries.WithTx(tx)
	orphans, err := q.OrphanShasOfUser(ctx, user)
	if err != nil {
		return nil, fmt.Errorf("tracks: %w", err)
	}
	if err := q.DeleteRoomsOwnedBy(ctx, user); err != nil {
		return nil, fmt.Errorf("rooms: %w", err)
	}
	if s.crews != nil {
		if err := s.crews.ReleaseCrews(ctx, q, user); err != nil {
			return nil, fmt.Errorf("crews: %w", err)
		}
	}
	if err := q.DeleteUser(ctx, user); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return orphans, nil
}

// timeOrNil is a nullable timestamp as the file should read it: a time, or
// null — never Go's zero date dressed as one.
func timeOrNil(t pgtype.Timestamptz) any {
	if !t.Valid {
		return nil
	}
	return t.Time
}

// mapRows turns a query's rows into the shape the export writes: the reader's
// vocabulary, not the schema's. An empty result is an empty array rather than
// null — a rider with no playlists should read "none", not "unknown".
func mapRows[R any](rows []R, err error, one func(R) any) (any, error) {
	if err != nil {
		return nil, err
	}
	out := make([]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, one(row))
	}
	return out, nil
}
