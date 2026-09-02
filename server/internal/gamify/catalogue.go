package gamify

// Achievement tiers (docs/SPEC.md XP sources, defaults — tune in alpha):
// paid once, on the day the achievement is earned.
const (
	XpEasy   = 100
	XpMedium = 250
	XpHard   = 500
)

// Achievement keys — the ledger's and the client's vocabulary.
const (
	keySunrise    = "sunrise-club"
	keyNightShift = "night-shift"
	key200Rides   = "200-rides"
	keySufferfest = "sufferfest-survivor"
	keyHotEnd     = "hot-end"
	keyEspresso   = "espresso-ride"
	keyLounge     = "lounge-lizard"
	keyDJ         = "dj"
	keyCrewChief  = "crew-chief"
	keySprintSnob = "sprint-snob"
)

// Achievement is one catalogue entry. The client's copy of this table lives
// in web/src/lib/trophies/catalogue.ts — catalogue_test.go keeps the two in
// step by key, in order.
type Achievement struct {
	Key  string
	Name string
	How  string
	// The lucide icon name the client draws, like room icons (#447).
	Icon string
	XP   int
	// How many of the counted thing earn it. Zero for the ride
	// achievements, which are judged per ride at save time from the
	// samples in hand and show no partial progress.
	Need int
}

// Catalogue is every achievement the server can verify on its own (#467).
// The Quiet Type (never unmuting) and Never Gonna Give You Up (a track
// queued "as a joke") are not here: mute state is client-reported and a
// joke is not a fact the server holds.
var Catalogue = []Achievement{
	{Key: keySunrise, Name: "Sunrise Club", How: "5 rides started before 07:00, server time",
		Icon: "sunrise", XP: XpEasy, Need: 5},
	{Key: keyNightShift, Name: "Night Shift", How: "5 rides ended after 23:00, server time",
		Icon: "moon", XP: XpEasy, Need: 5},
	{Key: key200Rides, Name: "200 Rides", How: "Two hundred rides on WattRoom",
		Icon: "bike", XP: XpHard, Need: 200},
	{Key: keySufferfest, Name: "Sufferfest Survivor", How: "45 minutes at or above FTP in one ride",
		Icon: "skull", XP: XpHard},
	{Key: keyHotEnd, Name: "Hot End", How: "3 minutes in Z6 in one ride",
		Icon: "flame", XP: XpMedium},
	{Key: keyEspresso, Name: "Espresso Ride", How: "A ride under 25 minutes, 80 % of it above sweet spot",
		Icon: "coffee", XP: XpMedium},
	{Key: keyLounge, Name: "Lounge Lizard", How: "10 hours in a lounge, in voice",
		Icon: "headphones", XP: XpMedium, Need: 10 * 60},
	{Key: keyDJ, Name: "DJ", How: "Queue 50 tracks the room played to the end",
		Icon: "music", XP: XpMedium, Need: 50},
	{Key: keyCrewChief, Name: "Crew Chief", How: "Coach 20 sessions with 3+ riders",
		Icon: "users", XP: XpHard, Need: 20},
	{Key: keySprintSnob, Name: "Sprint Snob", How: "Win 10 sprint moments on w/kg",
		Icon: "zap", XP: XpMedium, Need: 10},
}

func byKey(key string) (Achievement, bool) {
	for _, a := range Catalogue {
		if a.Key == key {
			return a, true
		}
	}
	return Achievement{}, false
}
