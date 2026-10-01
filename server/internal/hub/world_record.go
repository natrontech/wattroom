package hub

import "github.com/natrontech/wattroom/server/internal/protocol"

// The bunch's side of a ride saved with its road (#3738, ADR-0065): where
// each joined rider stood each second, as the bunch carried them. A bunch
// tows its riders, so the road it saves times nothing (ADR-0074).

// track writes down where each joined rider stands at the end of the second
// just ridden: the bunch's place and their own offset in it, laps unrolled,
// never before the road's start.
func (b *bunch) track(elapsed int) {
	for id, pl := range b.places {
		b.trail.write(id, elapsed, max(b.fromM+b.pace.Distance+pl.offset, 0))
	}
}

// storedAt is a place u — laps unrolled, in the direction ridden — as the
// stored road counts it, and its height on the crew's cut. A reversed cut is
// counted back down the stored road, and a loop starts over every lap.
func (b *bunch) storedAt(u float64, route *routeRide) (m, alt float64) {
	along, _ := b.place(u)
	cut := along
	if b.reverse {
		cut = b.road.LengthM - along
	}
	return route.storedM(cut), b.heightAt(along)
}

// stamp stands each of a rider's samples where the bunch had them at the end
// of that sample's second, in the stored road's metres and at the cut's
// relative height. A rider the bunch never placed is left as they came, and
// a gap is left a gap: a towed ride is timed nowhere.
func (b *bunch) stamp(riderID string, samples []protocol.RiderMetrics, route *routeRide) []protocol.RiderMetrics {
	if _, in := b.trail.at(riderID, 0); !in || route == nil {
		return samples
	}
	for i := range samples {
		u, _ := b.trail.at(riderID, samples[i].Clock)
		samples[i].M, samples[i].Alt = b.storedAt(u, route)
	}
	return samples
}

// recordRoad is one rider's ride along the bunch's road, for the saver:
// where on the stored road the bunch first placed them, and the metres it
// carried them and climbed, laps unrolled — towed, so it times nothing.
func (b *bunch) recordRoad(riderID string, route *routeRide) *RecordRoad {
	first, last, ok := b.trail.span(riderID)
	if !ok || route == nil {
		return nil
	}
	from, _ := b.storedAt(first, route)
	return &RecordRoad{
		RouteID: route.ID, RoadHash: route.Hash,
		FromM: from, DistanceM: max(last-first, 0), ClimbedM: b.rise(first, last),
		Towed: true,
	}
}
