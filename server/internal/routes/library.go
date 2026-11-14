package routes

import (
	"embed"
	"fmt"

	"github.com/natrontech/wattroom/server/internal/road"
)

// WattRoom's own roads (#4248, #4258): loops made up from invented corners,
// built in the browser ($lib/ride/home-roads), with a frozen copy of each
// here so a crew can ride one in a session. Nobody owns them and nothing
// about them is a place, so every reader gets the whole road and its name,
// and no route row backs them: a ride or a plan on one keeps no route id.
// web/src/lib/ride/home-roads.golden.test.ts holds the copies to the roads
// the browser builds.

//go:embed library/*.road
var libraryFiles embed.FS

// libraryRoad is one of WattRoom's roads as a session rides it.
type libraryRoad struct {
	name string
	road road.Road
	// The packed road's hash, the key a client caches a road under.
	hash string
}

var library = func() map[string]libraryRoad {
	out := map[string]libraryRoad{}
	for id, name := range map[string]string{
		"7a77b0ad-0001-4000-8000-000000004248": "Pass loop",
		"7a77b0ad-0002-4000-8000-000000004248": "Valley loop",
		"7a77b0ad-0003-4000-8000-000000004248": "Col de Berne",
		"7a77b0ad-0004-4000-8000-000000004248": "Tour de l’Aaren",
		"7a77b0ad-0005-4000-8000-000000004248": "Urnsee-Rundfahrt",
		"7a77b0ad-0006-4000-8000-000000004248": "Flèche du Lac",
		"7a77b0ad-0007-4000-8000-000000004248": "Kettental-Runde",
	} {
		packed, err := libraryFiles.ReadFile("library/" + id + ".road")
		if err != nil {
			panic(fmt.Sprintf("routes: library road %s: %v", id, err))
		}
		rd, err := road.UnpackRoad(packed)
		if err != nil {
			panic(fmt.Sprintf("routes: library road %s unreadable: %v", id, err))
		}
		out[id] = libraryRoad{name: name, road: rd, hash: roadHash(packed)}
	}
	return out
}()

// fromLibrary is one of WattRoom's roads, by the id a session rides it under.
func fromLibrary(routeID string) (libraryRoad, bool) {
	r, ok := library[routeID]
	return r, ok
}

// LibraryName says whether name is one of WattRoom's roads' names (#4248):
// invented, so a ride saved under one may carry it wherever the ride goes,
// a Strava title and a posted card included, as no rider's route may.
func LibraryName(name string) bool {
	for _, r := range library {
		if r.name == name {
			return true
		}
	}
	return false
}
