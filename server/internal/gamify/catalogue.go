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
// step by key, in order. The words a rider reads, the name and the rule, are
// the client's alone (#2876 L9-10): the server never sent them, and a second
// copy here had already drifted from what riders saw.
type Achievement struct {
	Key string
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
	{Key: keySunrise, Icon: "sunrise", XP: XpEasy, Need: 5},
	{Key: keyNightShift, Icon: "moon", XP: XpEasy, Need: 5},
	{Key: key200Rides, Icon: "bike", XP: XpHard, Need: 200},
	{Key: keySufferfest, Icon: "skull", XP: XpHard},
	{Key: keyHotEnd, Icon: "flame", XP: XpMedium},
	{Key: keyEspresso, Icon: "coffee", XP: XpMedium},
	{Key: keyLounge, Icon: "headphones", XP: XpMedium, Need: 10 * 60},
	{Key: keyDJ, Icon: "music", XP: XpMedium, Need: 50},
	{Key: keyCrewChief, Icon: "users", XP: XpHard, Need: 20},
	{Key: keySprintSnob, Icon: "zap", XP: XpMedium, Need: 10},
}

func byKey(key string) (Achievement, bool) {
	for _, a := range Catalogue {
		if a.Key == key {
			return a, true
		}
	}
	return Achievement{}, false
}
