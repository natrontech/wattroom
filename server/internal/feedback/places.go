package feedback

import (
	"context"
	"regexp"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

// Routes is where a reporter's own route names come from. A report becomes
// a public issue that agents work, and a route's name is a place (#3054,
// ADR-0063): it never enters an AI context.
type Routes interface {
	ListOwnerRoutes(ctx context.Context, ownerID pgtype.UUID) ([]db.ListOwnerRoutesRow, error)
}

// aRoute is what a route's name reads as once it is taken out, aPlace a
// coordinate.
const aRoute, aPlace = "a route", "a place"

// coordinate is a latitude's or longitude's shape: a nonzero whole part of at
// most three digits and four decimals or more. A map library's error prints
// one ("LngLat(7.44744, 46.94812)").
var coordinate = regexp.MustCompile(`-?\b[1-9]\d{0,2}\.\d{4,}`)

// pathOnly is a route without its query or fragment: `?road=` names a stored
// route, and the rest is rider-supplied — one more place a name could ride.
func pathOnly(route string) string {
	if i := strings.IndexAny(route, "?#"); i >= 0 {
		return route[:i]
	}
	return route
}

// withoutPlaces takes the reporter's route names and anything shaped like a
// coordinate out of everything in the report that is text: the note, the
// first error, and every string the flight recorder kept. The only names the
// reporter's client can know are their own — every other rider's route
// reaches them as its gen_name, which is numbers. ponytail: a corridor's or a
// climb's names join this list when the server has them (M14); only route
// names exist today.
func (s *Service) withoutPlaces(ctx context.Context, owner pgtype.UUID, report *Report) error {
	report.Route = pathOnly(report.Route)
	routes, err := s.routes.ListOwnerRoutes(ctx, owner)
	if err != nil {
		return err
	}
	names := make([]string, 0, len(routes))
	for _, r := range routes {
		names = append(names, regexp.QuoteMeta(r.Name))
	}
	// The longest first: "Gurnigel" before "Gurnigel loop" would leave " loop".
	slices.SortFunc(names, func(a, b string) int { return len(b) - len(a) })
	var route *regexp.Regexp
	if len(names) > 0 {
		route = regexp.MustCompile("(?i)" + strings.Join(names, "|"))
	}
	scrub := func(s *string) {
		if route != nil {
			*s = route.ReplaceAllLiteralString(*s, aRoute)
		}
		*s = coordinate.ReplaceAllLiteralString(*s, aPlace)
	}
	scrub(&report.Note)
	scrub(&report.FirstError)
	for i := range report.Buffer.Ticks {
		scrub(&report.Buffer.Ticks[i].State)
	}
	for i := range report.Buffer.Events {
		scrub(&report.Buffer.Events[i].Kind)
		scrub(&report.Buffer.Events[i].Text)
	}
	for i := range report.Buffer.Errors {
		scrub(&report.Buffer.Errors[i].Text)
	}
	return nil
}
