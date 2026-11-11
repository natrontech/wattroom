package stats

import "testing"

// A workout ridden by its clock over a road keeps its own name beside the
// road's (#3055); every ride the road alone names keeps none.
func TestWorkoutOwnName(t *testing.T) {
	const road = `"road":{"routeId":"00000000-0000-4000-8000-000000000001","fromM":0,"toM":32000}`
	const steady = `"steps":[{"type":"steady","seconds":600,"target":0.9}]`
	const saved = "Road · 32.0 km · 410 m"
	for _, c := range []struct {
		what, json, savedAs, want string
	}{
		{"a workout on a route", `{"name":"Sweet spot",` + road + `,` + steady + `}`, saved, "Sweet spot"},
		{"its cut attached beside the reference", `{"name":" Sweet spot ","road":{"routeId":"x","fromM":0,"toM":32000,"profile":"AAAA"},` + steady + `}`, saved, "Sweet spot"},
		{"no road: the name is already the workout's", `{"name":"Sweet spot",` + steady + `}`, "Sweet spot", ""},
		{"a road workout, its blocks pinned to metres", `{"name":"` + saved + `","road":{"routeId":"x","fromM":0,"toM":32000,"stepEndM":[32000]},` + steady + `}`, saved, ""},
		{"a free ride on a road", `{"name":"Free ride","unscored":true,` + road + `,"steps":[]}`, saved, ""},
		{"road steps alone ask no watts", `{"name":"Home loop",` + road + `,"steps":[{"type":"road","seconds":600}]}`, saved, ""},
		{"named by the road's own name", `{"name":"` + saved + ` · leg 1 of 2",` + road + `,` + steady + `}`, saved, ""},
		{"no name", `{"name":"  ",` + road + `,` + steady + `}`, saved, ""},
		{"not a workout", `{`, saved, ""},
	} {
		got := ""
		if own := WorkoutOwnName(c.json, c.savedAs); own != nil {
			got = *own
		}
		if got != c.want {
			t.Errorf("%s: %q, want %q", c.what, got, c.want)
		}
	}
}
