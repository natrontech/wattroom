// Package avatars keeps a rider's face on WattRoom's own origin (#2078).
//
// A rider who signs in with Google, GitHub or Strava arrives with the picture
// *that provider serves*, as an absolute URL. Stored and drawn as a plain
// <img>, that URL turns every roster, thread and room tile into a beacon: the
// provider's CDN is told which rider is looking at what, and when. Privacy is
// architecture (WATTROOM.md), and a face fetched from Google every time a room
// paints is not it — it is also why the enforced img-src could not name its
// hosts until now (#2069, server/headers.go).
//
// So the picture is copied once, into the same table an uploaded one lives in,
// and users.avatar_url only ever holds an address on this origin. Two things
// this package deliberately is not:
//
//   - Not a proxy endpoint. Nothing here takes a URL from a request. The only
//     address ever fetched is the one the rider's own provider handed over
//     during their own sign-in, and it is fetched at most once.
//   - Not a cache. The bytes in user_avatars are the cache, keyed by the rider
//     they belong to and written once. There is no shared, URL-keyed entry
//     whose presence a second rider could time — the cross-rider oracle #1739
//     had to take out of unfurl cannot be built out of a row that only its own
//     rider's sign-in writes.
package avatars

import (
	"context"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// ImageFetcher is the guarded outbound read: unfurl.Fetcher (ADR-0031's SSRF
// guard, redirect cap, pinned dial). An interface so a test needs no network —
// never so a second implementation can exist. There is one outbound fetcher in
// this app and this is not the place to write another.
type ImageFetcher interface {
	Image(ctx context.Context, url string, max int64) (data []byte, mime string, err error)
}

const (
	// MaxBytes: the same ceiling the rider's own upload gets
	// (httpx.MaxImageBytes). A face drawn at 40–96 px is a few kB and every
	// provider serves well under this, so the cap is the trust boundary
	// rather than the target — and one number for both kinds of picture means
	// there is no size a mirrored one may reach that an uploaded one may not.
	MaxBytes = httpx.MaxImageBytes
	// fetchTimeout bounds what a signing-in rider waits for. Short on
	// purpose: the provider's CDN answered a moment ago in the same flow, and
	// past this the sign-in is better finished with the initial the app
	// already draws than held open by somebody else's outage.
	fetchTimeout = 5 * time.Second
	// backfillPage is how many old rows one pass converts. Sequential inside
	// the page, so exactly one socket is open at a stranger's host at a time
	// and a stalled one costs the pass its timeout rather than a burst of
	// connections.
	backfillPage = 50
	// backfillPasses is the hard stop, for the case a row will not leave the
	// set because its write keeps failing (secrets.Backfill's shape).
	backfillPasses = 1000
)

// Mirror copies sign-in pictures onto this origin.
type Mirror struct {
	st    *store.Store
	fetch ImageFetcher
	log   *slog.Logger
}

func New(st *store.Store, fetch ImageFetcher, log *slog.Logger) *Mirror {
	return &Mirror{st: st, fetch: fetch, log: log}
}

// Path is the one address a stored picture is served at, for both kinds:
// /api/riders/{id}/avatar (server/internal/riders), versioned by the set time
// so a replaced picture is a new address everywhere at once (#1353).
func Path(id pgtype.UUID, setAt time.Time) string {
	return "/api/riders/" + store.UUIDString(id) + "/avatar?v=" +
		strconv.FormatInt(setAt.UnixMilli(), 10)
}

// OffOrigin says whether a stored avatar_url points at somebody else's host.
// Ours is a path on this origin, so anything else is theirs — the invariant
// this package keeps is that no row holds one of these once a sign-in or the
// backfill has seen it.
//
// One leading slash and not two: //host/picture.png is a protocol-relative
// URL and loads from a stranger exactly like https:// does. Nothing writes
// one, which is precisely why the check has to say so rather than the reader
// having to notice. ListProviderAvatars in users.sql draws the same line.
func OffOrigin(url *string) bool {
	if url == nil || *url == "" {
		return false
	}
	return !strings.HasPrefix(*url, "/") || strings.HasPrefix(*url, "//")
}

// Adopt copies the picture a provider offered for this rider into WattRoom's
// own storage and returns their record with the new address on it.
//
// It does nothing when the provider offered no picture, and nothing when the
// rider already has bytes of their own — an uploaded picture is never replaced
// by a provider's, which is also what makes this safe to call on every
// sign-in rather than only the first.
//
// A failure is not an error anybody reads. The rider gets the initial the app
// draws for a rider with no picture (Avatar.svelte), the stored address is
// cleared rather than left pointing at a host we would not fetch from, and the
// next sign-in tries again — the provider hands the URL over every time, so
// nothing has to be kept for the retry.
func (m *Mirror) Adopt(ctx context.Context, user db.User, providerURL string) db.User {
	if providerURL == "" {
		return user
	}
	url, changed := m.adopt(ctx, user.ID, user.AvatarUrl, providerURL)
	if changed {
		user.AvatarUrl = url
	}
	return user
}

// adopt is Adopt over an id and the row's current address, so a sign-in and
// the backfill run the same code. It reports the row's new avatar_url and
// whether the row was written.
func (m *Mirror) adopt(ctx context.Context, id pgtype.UUID, current *string, providerURL string) (*string, bool) {
	rider := store.UUIDString(id)
	// The set time and not the picture: this runs on every sign-in and the
	// answer for a rider who already has one is "do nothing", so the bytes
	// would be read out and dropped.
	switch setAt, err := m.st.Queries.GetUserAvatarSetAt(ctx, id); {
	case err == nil:
		// Bytes of their own — an upload, or a picture an earlier sign-in
		// mirrored — and those are never overwritten by a provider's. The
		// address is repointed only when it still names somebody else's host,
		// which no code path can produce, because an upload writes the bytes
		// and the address in one statement. It is here so that a row which
		// somehow held both could not keep the leak and stall the backfill's
		// progress check at the same time.
		if !OffOrigin(current) {
			return nil, false
		}
		url := Path(id, setAt.Time)
		if err := m.st.Queries.SetUserAvatarURL(ctx, db.SetUserAvatarURLParams{
			ID: id, AvatarUrl: &url,
		}); err != nil {
			m.log.Error("sign-in picture: repoint", "rider", rider, "err", err)
			return nil, false
		}
		return &url, true
	case errors.Is(err, pgx.ErrNoRows):
	default:
		m.log.Error("sign-in picture: read stored", "rider", rider, "err", err)
		return nil, false
	}

	fetchCtx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	data, mime, err := m.fetch.Image(fetchCtx, providerURL, MaxBytes)
	if err != nil {
		// Debug, not warn: a provider that is slow, private or serving
		// something that is not a picture is an ordinary outcome with a
		// defined fallback, not an incident. No URL in the line either — it
		// names the rider's provider account, and server/AGENTS.md logs ids.
		m.log.Debug("sign-in picture not mirrored", "rider", rider, "err", err)
		if !OffOrigin(current) {
			return nil, false // nothing stored that could leak
		}
		return nil, m.forget(ctx, id)
	}

	setAt := time.Now()
	url := Path(id, setAt)
	if _, err := m.st.Queries.SetUserAvatar(ctx, db.SetUserAvatarParams{
		ID: id, Mime: mime, Image: data,
		SetAt:     pgtype.Timestamptz{Time: setAt, Valid: true},
		AvatarUrl: &url,
	}); err != nil {
		m.log.Error("sign-in picture: store", "rider", rider, "err", err)
		if !OffOrigin(current) {
			return nil, false
		}
		return nil, m.forget(ctx, id)
	}
	return &url, true
}

// forget clears an address we could not fetch. It reports whether the row now
// holds nothing, so a caller holding a stale copy can say the same.
func (m *Mirror) forget(ctx context.Context, id pgtype.UUID) bool {
	if err := m.st.Queries.ClearProviderAvatarURL(ctx, id); err != nil {
		m.log.Error("sign-in picture: clear", "rider", store.UUIDString(id), "err", err)
		return false
	}
	return true
}

// Backfill converts the rows written before this release, once, at boot: they
// hold a provider's absolute URL, and the enforced img-src refuses to load one
// — so until a row is converted that rider shows as an initial.
//
// Deliberately best-effort and off the boot path, like secrets.Backfill: a row
// it cannot convert is left as it was and the next boot tries again, and a
// server that refuses to start because one picture would not download helps
// nobody. One page at a time, sequentially, so a table of ten thousand riders
// is bounded work rather than ten thousand simultaneous sockets at Google.
func (m *Mirror) Backfill(ctx context.Context) {
	mirrored, cleared := 0, 0
	for pass := 0; pass < backfillPasses; pass++ {
		rows, err := m.st.Queries.ListProviderAvatars(ctx, backfillPage)
		if err != nil {
			m.log.Error("avatar backfill: list", "err", err)
			break
		}
		if len(rows) == 0 {
			break
		}
		before := mirrored + cleared
		for _, row := range rows {
			if ctx.Err() != nil {
				m.log.Warn("avatar backfill: out of time", "mirrored", mirrored, "cleared", cleared)
				return
			}
			url, changed := m.adopt(ctx, row.ID, row.AvatarUrl, *row.AvatarUrl)
			switch {
			case url != nil:
				mirrored++
			case changed:
				cleared++
			}
		}
		// A pass that changed nothing would come back identical: stop rather
		// than spin on rows that will not update.
		if mirrored+cleared == before {
			break
		}
	}
	if mirrored+cleared > 0 {
		m.log.Info("mirrored sign-in pictures onto this origin",
			"mirrored", mirrored, "cleared", cleared)
	}
}
