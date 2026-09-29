package account

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/secrets"
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
	// tables are the tables with a foreign key to users whose rows this file
	// carries (#3045). TestExportCoversEveryTableThatHoldsARidersRows walks
	// the schema against them, so a new table a rider owns is either declared
	// here by the category that exports it or excluded there with a reason.
	tables []string
	rows   func() (any, error)
}

// export is one archive being built: whose it is, and what the categories
// find on the way that the file-writing half after them still needs. Each
// category is a method in the export_*.go file for its part of the account,
// so a new one lands in a file of its own (#3045).
type export struct {
	ctx      context.Context
	q        *db.Queries
	user     db.User
	rideRows []db.ListUserRidesFullRow
	// Filled by a bounded category, read into its manifest entry.
	truncated map[string]bool
	// The clips soundboard.json listed, for the bytes loop after the
	// categories: one read serves the rows and the files (#2090).
	clipIDs []pgtype.UUID
	// And the avatar, read once by its own category and written there too.
	avatarFile struct {
		name  string
		bytes []byte
	}
	// The key a route's map opens with (#3024), and what routes.json found:
	// the routes to write a GPX of, and how many had a map to write one of.
	keys            *secrets.Cipher
	routeFiles      []routeFile
	routesWithPlace int
}

// categories is everything the account holds besides the profile (#696), in
// the order the archive and its manifest list them. One query per category,
// each user-scoped and each mapped to the keys a person reads rather than
// the column names a database uses — this is a file the rider opens. A
// category that fails to read loses itself, not the export: someone entitled
// to their data should get what we could gather, not a 500.
func (x *export) categories() []category {
	return []category{
		x.rides(), x.chat(), x.messages(), x.sessions(), x.friends(), x.dismissedRequests(), x.hiddenRiders(),
		x.playlists(), x.tracks(), x.plannedSessions(), x.workouts(), x.xp(), x.trophies(),
		x.identities(), x.passkeys(), x.coachAccess(), x.reactions(), x.crews(), x.pins(),
		x.scheduledSessions(), x.channelMembers(), x.soundboard(), x.rideUploads(),
		x.avatar(), x.images(), x.emoji(), x.medals(), x.routes(), x.wallet(), x.wardrobe(),
	}
}

// bounded declares a category read under maxExportRows: the rider gets the
// bound's worth and manifest.json says the category was cut short when the
// bound bit. The read hands back how many rows it saw, so a category's name,
// its bound and the note about it are written once and cannot drift apart —
// the drift being what would make an export go quietly short again.
func (x *export) bounded(name string, tables []string, read func() (any, int, error)) category {
	return category{name, tables, func() (any, error) {
		out, n, err := read()
		if err == nil && n >= int(maxExportRows) {
			x.truncated[name] = true
		}
		return out, err
	}}
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
// The tables among them are also on notExported in the coverage test (#3045),
// which fails on a rider-owned table that is on neither list.
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
//     served under — so nothing about the omission is silent.
//
//     The rest of what a rider uploads is NO LONGER omitted (ADR-0053,
//     #2090): the avatar and the clips they posted to chat and DMs are
//     written into `uploads/` further down, one at a time, and `images.json`
//     is the index. This note said they were still pending long after they
//     stopped being, which is the same failure in the other direction
//     (#2253) — a reader trusting it would have gone looking for a gap that
//     is not there.
//
//   - The auth `sessions` table: a hash of a cookie, with no screen anywhere
//     that lists a rider's live sessions. There is nothing here to hand back
//     that would mean anything, and handing back session material is not an
//     improvement.
//
//   - `channel_reads`, `dm_reads` and `track_plays`, one judgement for all
//     three: bookkeeping attributable to the rider that no screen shows
//     them. The two reads tables are unread-marker cursors. track_plays is
//     read back only as a ROOM's last five titles, the same five for
//     everyone in it, with no date and no per-rider view — so a dated,
//     cross-room list of everything the rider ever queued would be strictly
//     more than they can see, which is the line this export stops at. If a
//     "what I put on" surface ever ships, this is the category to add with
//     it. `ride_upload_xp` (#3044) takes the same judgement: one number,
//     today's running total under the uploaded-ride XP ceiling, and the XP
//     it bounds is in rides.json ride by ride.
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
	if !s.exports.Acquire(user.ID) {
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
			"Your export is already being built. Wait for it to finish, then ask again.")
		return
	}
	// Every return below gives the slot back, and so does a panic on the way
	// out: an entry left behind would lock this rider out of their own data
	// until the next restart, which is a worse bug than the one the ceiling
	// fixes.
	defer s.exports.Release(user.ID)

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

	x := &export{ctx: r.Context(), q: s.store.Queries, user: user, rideRows: rides,
		truncated: map[string]bool{}, keys: s.routeKeys}
	profile, err := x.profile()
	if err != nil {
		fail("export home crew", err)
		return
	}
	if !writeJSON("profile.json", profile) {
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
	manifest := []entry{{Name: "profile.json", Ok: true}}
	for _, cat := range x.categories() {
		rows, err := cat.rows()
		if err != nil {
			s.log.Error("export category failed", "category", cat.name, "err", err)
			manifest = append(manifest, entry{Name: cat.name, Ok: false})
			continue
		}
		if !writeJSON(cat.name, rows) {
			return
		}
		manifest = append(manifest, entry{Name: cat.name, Ok: true, Truncated: x.truncated[cat.name]})
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
	// The files the rider uploaded themselves (#2090, ADR-0053). One clip at
	// a time, the samples loop's rule and for the same reason: docs/SPEC.md
	// lets a rider hold 100 MB of clips, and holding them all beside the zip
	// doubles that for no gain.
	writeUpload := func(name string, body []byte) bool {
		f, err := archive.Create(name)
		if err == nil {
			_, err = f.Write(body)
		}
		if err != nil {
			fail("export write "+name, err)
			return false
		}
		return true
	}
	if x.avatarFile.name != "" && !writeUpload(x.avatarFile.name, x.avatarFile.bytes) {
		return
	}
	clipsWritten := 0
	for _, id := range x.clipIDs {
		clip, err := s.store.Queries.GetBoardClip(r.Context(), id)
		// One unreadable clip loses its audio, not the export — and the
		// manifest below counts what was written, so it does not go quietly.
		// The owner check is a second lock on a query that has no rider in
		// it: a clip is served by id alone, so nothing else here says whose
		// bytes these are.
		if err != nil || clip.UserID != user.ID {
			continue
		}
		if !writeUpload("uploads/soundboard/"+store.UUIDString(id)+".mp3", clip.Bytes) {
			return
		}
		clipsWritten++
	}
	routesWritten, err := x.writeRoutes(archive.Create, x.gpx)
	if err != nil {
		fail("export write routes", err)
		return
	}
	if !writeJSON("manifest.json", map[string]any{
		"generatedAt": time.Now().UTC(),
		"categories":  manifest,
		"samples":     map[string]int{"rides": len(rides), "written": samplesWritten},
		// What went in beside the JSON (#2090): the rider's own files. An
		// avatar is one row or none, so it says whether; clips count, the way
		// samples do, because a missing one is otherwise silent.
		"uploads": map[string]any{
			"avatar": x.avatarFile.name != "",
			"clips":  map[string]int{"rows": len(x.clipIDs), "written": clipsWritten},
			// A route's GPX needs its map (#3024): one stored without a key
			// has heights only, in routes.json, and is not owed a file.
			"routes": map[string]int{"withMap": x.routesWithPlace, "written": routesWritten},
		},
		"complete": samplesWritten == len(rides) && clipsWritten == len(x.clipIDs) &&
			routesWritten == x.routesWithPlace &&
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
	// The largest and most sensitive thing this server hands out — every
	// ride's heart rate (ADR-0008), the calendar and unsubscribe tokens,
	// every crew's code, the rider's own uploads — and a 200 with no
	// directive is heuristically cacheable (RFC 9111 §4.2.2), on a stack
	// self-hosters put a proxy in front of (#2250). httpx says this on every
	// JSON answer and the two other downloads say it too; this one did not.
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(buf.Bytes())
}
