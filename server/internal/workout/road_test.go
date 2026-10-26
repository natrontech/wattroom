package workout

import (
	"strings"
	"testing"
)

const routeID = "3f0c2a4e-8b1d-4c5e-9f6a-7b8c9d0e1f2a"

func withRoad(road string, steps string) string {
	if steps == "" {
		steps = `[{"type":"road","seconds":600}]`
	}
	return `{"name":"On a road","road":` + road + `,"steps":` + steps + `}`
}

// Where no place may travel (#4154), a road goes as its length, and one that
// cannot be read still never falls back to the name it was given.
func TestAPlainNameCarriesARoadsNumbersAlone(t *testing.T) {
	for _, c := range []struct{ name, json, want string }{
		{"a road", withRoad(`{"routeId":"`+routeID+`","fromM":1200,"toM":53100}`, ""), "Route ride · 51.9 km"},
		{"an attached copy", withRoad(`{"routeId":"`+routeID+`","fromM":0,"toM":3000,"profile":"AAAA"}`, ""), "Route ride"},
		{"no road", `{"name":"Sweet spot","steps":[{"type":"steady","seconds":600,"target":0.9}]}`, "Sweet spot"},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := PlainName(c.json, "Sweet spot"); got != c.want {
				t.Errorf("PlainName = %q, want %q", got, c.want)
			}
		})
	}
}

// A workout rides a road whether or not its copy is the strict reference
// RoadOf takes (#4154): the save is handed the copy with its cut attached.
func TestOnRoadReadsAnyCopyOfARoad(t *testing.T) {
	for _, c := range []struct {
		name, json string
		want       bool
	}{
		{"a reference", withRoad(`{"routeId":"`+routeID+`","fromM":0,"toM":3000}`, ""), true},
		{"an attached copy", withRoad(`{"routeId":"`+routeID+`","fromM":0,"toM":3000,"profile":"AAAA"}`, ""), true},
		{"a null road", withRoad(`null`, ""), false},
		{"no road", `{"name":"Sweet spot","steps":[]}`, false},
		{"not a workout", `nope`, false},
	} {
		if got := OnRoad(c.json); got != c.want {
			t.Errorf("%s: OnRoad = %v, want %v", c.name, got, c.want)
		}
	}
}

// #3051's validation matrix: a workout carries its road as a reference and
// nothing else, and a road step is a length of time on it.
func TestAWorkoutsRoadIsAReferenceOnly(t *testing.T) {
	for _, c := range []struct {
		name, json string
		ok         bool
		says       string
	}{
		{"a reference", withRoad(`{"routeId":"`+routeID+`","fromM":0,"toM":5000}`, ""), true, ""},
		{"with block ends", withRoad(`{"routeId":"`+routeID+`","fromM":1000,"toM":5000,"stepEndM":[2000,5000]}`, ""), true, ""},
		{"no road at all", `{"name":"x","steps":[{"type":"steady","seconds":60,"target":0.6}]}`, true, ""},
		{"a profile planted beside it", withRoad(`{"routeId":"`+routeID+`","fromM":0,"toM":5000,"profile":"AQID"}`, ""), false, "by reference only"},
		{"heights planted beside it", withRoad(`{"routeId":"`+routeID+`","fromM":0,"toM":5000,"heights":[1,2]}`, ""), false, "by reference only"},
		{"no route", withRoad(`{"routeId":"","fromM":0,"toM":5000}`, ""), false, "names no route"},
		{"a route that is no id", withRoad(`{"routeId":"home","fromM":0,"toM":5000}`, ""), false, "names no route"},
		{"running backwards", withRoad(`{"routeId":"`+routeID+`","fromM":5000,"toM":1000}`, ""), false, "runs forward"},
		{"behind the start", withRoad(`{"routeId":"`+routeID+`","fromM":-1,"toM":1000}`, ""), false, "runs forward"},
		{"past any route", withRoad(`{"routeId":"`+routeID+`","fromM":0,"toM":200001}`, ""), false, "runs forward"},
		{"blocks out of order", withRoad(`{"routeId":"`+routeID+`","fromM":0,"toM":5000,"stepEndM":[3000,2000]}`, ""), false, "in order"},
		{"a block past the stretch", withRoad(`{"routeId":"`+routeID+`","fromM":0,"toM":5000,"stepEndM":[6000]}`, ""), false, "in order"},
		{"a road step too short", withRoad(`{"routeId":"`+routeID+`","fromM":0,"toM":5000}`, `[{"type":"road","seconds":4}]`), false, "shorter than"},
		{"a road step too long", withRoad(`{"routeId":"`+routeID+`","fromM":0,"toM":5000}`, `[{"type":"road","seconds":14401}]`), false, "longer than"},
		{"a road step behind the road", withRoad(`{"routeId":"`+routeID+`","fromM":0,"toM":5000}`, `[{"type":"road","seconds":60,"fromM":-5}]`), false, "along the road"},
	} {
		err := Validate(c.json)
		if c.ok {
			if err != nil {
				t.Errorf("%s: refused: %v", c.name, err)
			}
			continue
		}
		msg, rider := RefusalMessage(err)
		if !rider || !strings.Contains(msg, c.says) {
			t.Errorf("%s: %v, want a refusal saying %q", c.name, err, c.says)
		}
	}
}

// A road step's grade is the road's, so it asks for no watts and scores
// nothing.
func TestARoadStepIsUntargetedAndUnscored(t *testing.T) {
	segments, err := Parse(withRoad(`{"routeId":"`+routeID+`","fromM":0,"toM":5000}`,
		`[{"type":"steady","seconds":60,"target":0.6},{"type":"road","seconds":120,"fromM":500}]`))
	if err != nil {
		t.Fatal(err)
	}
	if watts, scored := TargetAt(segments, 250, 100); watts != 0 || scored {
		t.Errorf("a road step asks for %.0f W, scored %v; want neither", watts, scored)
	}
	if watts, scored := TargetAt(segments, 250, 30); watts != 150 || !scored {
		t.Errorf("the steady block before it lost its target: %.0f W, scored %v", watts, scored)
	}
}
