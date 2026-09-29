// Package audience names who a change concerns (#2324): the riders whose
// lobby sockets a presence ping should reach. It used to reach every signed-in
// socket in the process, and each one re-ran about eleven requests for a
// change it could not see.
//
// Worked out when the change happens, from the store — the hub keeps no
// membership (#2900 showed it need not). The ping itself stays empty: no crew
// id, no slug, nothing a stranger could read activity off (lobby.go).
//
//   - A crew's own change goes to its members: Crew.
//   - A change inside a channel goes to whoever may enter it, and to the
//     friends of the riders it moved: Channel.
//   - A rider's own change (online, offline, their status line) goes to the
//     rider, their friends and their crew-mates: Rider.
//   - A friendship's goes to the two of them: Pair.
package audience

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Pinger is the lobby as the owner of a change reaches it. Satisfied by
// *hub.Hub.
type Pinger interface {
	// Every signed-in socket: for the change nobody could name an audience for.
	PresenceChanged()
	// These riders' sockets, every device of each, and nobody else's.
	PresenceChangedFor(audience []string)
}

// Tell pings the audience a lookup answered — or everyone, when the lookup
// failed: a wider re-fetch is the safe direction, a missed one is not. A nil
// pinger is a server without a hub, and nobody to tell.
func Tell(p Pinger, log *slog.Logger, audience []string, err error) {
	if p == nil {
		return
	}
	if err != nil {
		log.Warn("presence audience lookup failed; pinging everyone", "err", err)
		p.PresenceChanged()
		return
	}
	p.PresenceChangedFor(audience)
}

// Crew is a crew's owner, admins and members, plus `also` — a rider on their
// way out (a leave, a ban), whose screen still shows the crew.
func Crew(ctx context.Context, q *db.Queries, crew pgtype.UUID, also ...pgtype.UUID) ([]string, error) {
	members, err := q.CrewAudience(ctx, crew)
	if err != nil {
		return nil, err
	}
	return ids(append(members, also...)), nil
}

// Channel is whoever may enter the channel, the riders a change there moved,
// and those riders' friends — whose lists say "in voice" and "riding".
func Channel(ctx context.Context, q *db.Queries, channel pgtype.UUID, riders ...pgtype.UUID) ([]string, error) {
	enter, err := q.ChannelAudience(ctx, channel)
	if err != nil {
		return nil, err
	}
	friends, err := friendsOf(ctx, q, riders)
	if err != nil {
		return nil, err
	}
	return ids(append(append(enter, riders...), friends...)), nil
}

// Rider is the rider, their friends and everyone in a crew with them.
func Rider(ctx context.Context, q *db.Queries, rider pgtype.UUID) ([]string, error) {
	friends, err := friendsOf(ctx, q, []pgtype.UUID{rider})
	if err != nil {
		return nil, err
	}
	mates, err := q.CrewmatesOf(ctx, rider)
	if err != nil {
		return nil, err
	}
	return ids(append(append([]pgtype.UUID{rider}, friends...), mates...)), nil
}

// Pair is the two riders of a friendship or a block.
func Pair(a, b pgtype.UUID) []string {
	return ids([]pgtype.UUID{a, b})
}

func friendsOf(ctx context.Context, q *db.Queries, riders []pgtype.UUID) ([]pgtype.UUID, error) {
	if len(riders) == 0 {
		return nil, nil
	}
	return q.FriendsOf(ctx, riders)
}

// ids is the audience as the hub keys sockets: string ids, each once.
func ids(users []pgtype.UUID) []string {
	seen := make(map[pgtype.UUID]struct{}, len(users))
	out := make([]string, 0, len(users))
	for _, u := range users {
		if _, dup := seen[u]; dup || !u.Valid {
			continue
		}
		seen[u] = struct{}{}
		out = append(out, store.UUIDString(u))
	}
	return out
}

// Hub answers the hub's own changes — a socket, a voice roster, the tick —
// in the hub's string ids. The hub asks it outside its lock.
type Hub struct{ Q *db.Queries }

func (h Hub) Channel(ctx context.Context, channel string, riders []string) ([]string, error) {
	id, err := store.ParseUUID(channel)
	if err != nil {
		return nil, err
	}
	return Channel(ctx, h.Q, id, parse(riders)...)
}

func (h Hub) Rider(ctx context.Context, rider string) ([]string, error) {
	id, err := store.ParseUUID(rider)
	if err != nil {
		return nil, err
	}
	return Rider(ctx, h.Q, id)
}

// parse drops what is not an account id: the hub's riders are, but a test's
// or a guest's may not be, and they have no friends to tell.
func parse(riders []string) []pgtype.UUID {
	out := make([]pgtype.UUID, 0, len(riders))
	for _, r := range riders {
		if id, err := store.ParseUUID(r); err == nil {
			out = append(out, id)
		}
	}
	return out
}
