package road

import (
	"encoding/json"
	"flag"
	"go/ast"
	"go/parser"
	"go/token"
	"math"
	"os"
	"reflect"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

var update = flag.Bool("update", false, "rewrite the golden vectors from this model")

// The file both twins read (#3048). Regenerate it with
// `go test ./internal/road -run TestGolden -update` whenever the model or
// its constants move, and commit it: the TypeScript test replays it.
const goldenPath = "../protocol/testdata/road-golden.json"

type leg struct {
	Seconds  int     `json:"seconds"`
	Watts    float64 `json:"watts"`
	Grade    float64 `json:"grade"`
	Shelter  float64 `json:"shelter"`
	Speed    float64 `json:"speed"`    // m/s at the end of the leg
	Distance float64 `json:"distance"` // metres from the start of the vector
}

type vector struct {
	Name  string  `json:"name"`
	CdA   float64 `json:"cda"`
	Mass  float64 `json:"mass"`
	Speed float64 `json:"speed"` // m/s at the start
	// Where the road bends (#3204), metres from the vector's start; absent
	// is a road with no bends.
	Bends []bend `json:"bends,omitempty"`
	Legs  []leg  `json:"legs"`
}

// bend is a stretch of road on a circle of this radius.
type bend struct {
	FromM   float64 `json:"fromM"`
	ToM     float64 `json:"toM"`
	RadiusM float64 `json:"radiusM"`
}

// bendStep is the resampling a road's curvature is read at (docs/SPEC.md,
// every 10 m), and the one both twins build a vector's road on.
const bendStep = 10

// curvatureOf samples a vector's bends every bendStep metres, two samples
// past the last so the road runs straight after it.
func curvatureOf(bends []bend) []float64 {
	end := 0.0
	for _, b := range bends {
		end = math.Max(end, b.ToM)
	}
	k := make([]float64, int(math.Ceil(end/bendStep))+3)
	for i := range k {
		at := float64(i * bendStep)
		for _, b := range bends {
			if at >= b.FromM && at <= b.ToM {
				k[i] = 1 / b.RadiusM
			}
		}
	}
	return k
}

type golden struct {
	About   string   `json:"about"`
	Vectors []vector `json:"vectors"`
	// Shelter's own cases (#3233): the TypeScript twin reads the same ones.
	Shelters []shelterCase `json:"shelters"`
}

// shelterCase is one call of Shelter and what it returned.
type shelterCase struct {
	GapM      float64 `json:"gapM"`
	LaneDelta int     `json:"laneDelta"`
	LineIndex int     `json:"lineIndex"`
	Shelter   float64 `json:"shelter"`
}

// shelterCases walks the drafting table's edges: the front, each wheel, the
// fade, both adjacent lanes and beyond.
func shelterCases() []shelterCase {
	var out []shelterCase
	for _, gap := range []float64{-0.5, 0.3, 1, 2.2, 3.5, 5.9, 6, 7.5} {
		for _, lane := range []int{-2, -1, 0, 1, 2} {
			for _, line := range []int{0, 1, 2, 3, 7} {
				out = append(out, shelterCase{GapM: gap, LaneDelta: lane, LineIndex: line, Shelter: Shelter(gap, lane, line)})
			}
		}
	}
	return out
}

// The inputs; -update fills in where each leg ends.
func vectors() []vector {
	reference := float64(protocol.ReferenceRiderKg + protocol.BikeKg)
	watts := float64(protocol.ReferenceRiderWatts)
	var out []vector
	for _, cda := range []float64{protocol.PaceDefaultCdA, 0.40} {
		out = append(out,
			vector{Name: "the reference rider from a standstill on the flat", CdA: cda, Mass: reference,
				Legs: []leg{{Seconds: 300, Watts: watts}}},
			vector{Name: "the reference rider up 8 %", CdA: cda, Mass: reference, Speed: 5,
				Legs: []leg{{Seconds: 300, Watts: watts, Grade: 8}}},
			vector{Name: "over a crest, coasting down and riding on", CdA: cda, Mass: reference, Speed: 4,
				Legs: []leg{
					{Seconds: 60, Watts: watts, Grade: 8},
					{Seconds: 60, Grade: -6},
					{Seconds: 60, Watts: 150},
				}},
			vector{Name: "sheltered in a bunch", CdA: cda, Mass: reference, Speed: 9,
				Legs: []leg{{Seconds: 300, Watts: watts, Shelter: 0.3}}},
			vector{Name: "a heavy rider who stops pedalling", CdA: cda, Mass: 108, Speed: 6,
				Legs: []leg{
					{Seconds: 200, Watts: 300, Grade: 3},
					{Seconds: 120},
				}},
			vector{Name: "rolling down 10 % from a standstill", CdA: cda, Mass: reference,
				Legs: []leg{{Seconds: 120, Grade: -10}}},
			// #3233: the reference rider's watts at the speed they settle on,
			// alone, then behind one wheel, then deep in a line — shelter 0,
			// 0.35 and 0.50 — on the flat, at 3 % and at 6 %.
			vector{Name: "225 W on the flat, alone, behind a wheel, deep in a line", CdA: cda, Mass: reference,
				Speed: SteadySpeed(watts, 0, reference, cda, 0), Legs: shelteredLegs(watts, 0)},
			vector{Name: "225 W at 3 %, alone, behind a wheel, deep in a line", CdA: cda, Mass: reference,
				Speed: SteadySpeed(watts, 3, reference, cda, 0), Legs: shelteredLegs(watts, 3)},
			vector{Name: "225 W at 6 %, alone, behind a wheel, deep in a line", CdA: cda, Mass: reference,
				Speed: SteadySpeed(watts, 6, reference, cda, 0), Legs: shelteredLegs(watts, 6)},
			// #3204: coasting down −8 % at the speed it settles on, into a
			// 10 m hairpin 200 m on — braked for, ridden through at the
			// bend's limit, and ridden out of.
			vector{Name: "coasting down 8 % into a 10 m hairpin", CdA: cda, Mass: reference,
				Speed: SteadySpeed(0, -8, reference, cda, 0),
				Bends: []bend{{FromM: 200, ToM: 200 + math.Pi*10, RadiusM: 10}},
				Legs:  []leg{{Seconds: 10, Grade: -8}, {Seconds: 10, Grade: -8}, {Seconds: 10, Grade: -8}}},
		)
	}
	return out
}

// shelteredLegs is two minutes at each of shelter 0, 0.35 and 0.50.
func shelteredLegs(watts, grade float64) []leg {
	return []leg{
		{Seconds: 120, Watts: watts, Grade: grade},
		{Seconds: 120, Watts: watts, Grade: grade, Shelter: protocol.ShelterSecondWheel},
		{Seconds: 120, Watts: watts, Grade: grade, Shelter: protocol.ShelterMax},
	}
}

// ride replays a vector's legs through Pace and returns them with where each ended.
func ride(v vector) []leg {
	p := Pace{Speed: v.Speed}
	if v.Bends != nil {
		p.Limit = CornerLimit(curvatureOf(v.Bends), bendStep)
	}
	out := make([]leg, len(v.Legs))
	for i, l := range v.Legs {
		for range l.Seconds {
			p.Step(l.Watts, l.Grade, v.Mass, v.CdA, l.Shelter)
		}
		l.Speed, l.Distance = p.Speed, p.Distance
		out[i] = l
	}
	return out
}

func TestGolden(t *testing.T) {
	if *update {
		g := golden{
			About: "The pace model's golden vectors (#3048), written by `go test ./internal/road -run TestGolden -update` and replayed by web/src/lib/road/pace.test.ts; the two twins agree within 0.1 %.",
		}
		for _, v := range vectors() {
			v.Legs = ride(v)
			g.Vectors = append(g.Vectors, v)
		}
		g.Shelters = shelterCases()
		raw, err := json.MarshalIndent(g, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(goldenPath, append(raw, '\n'), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	raw, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("read %s: %v (run with -update to write it)", goldenPath, err)
	}
	var g golden
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	if cases := shelterCases(); len(g.Shelters) != len(cases) {
		t.Errorf("%d shelter cases in the file, the model defines %d: run with -update", len(g.Shelters), len(cases))
	}
	for _, c := range g.Shelters {
		if got := Shelter(c.GapM, c.LaneDelta, c.LineIndex); !near(got, c.Shelter, 1e-12) {
			t.Errorf("Shelter(%v, %d, %d) = %v; the file says %v — run with -update if the rule moved on purpose", c.GapM, c.LaneDelta, c.LineIndex, got, c.Shelter)
		}
	}
	want := vectors()
	if len(g.Vectors) != len(want) {
		t.Fatalf("%d golden vectors, the model defines %d: run with -update", len(g.Vectors), len(want))
	}
	for i, v := range g.Vectors {
		for j, got := range ride(v) {
			stored := v.Legs[j]
			if !near(got.Speed, stored.Speed, 1e-9) || !near(got.Distance, stored.Distance, 1e-9) {
				t.Errorf("%s (CdA %.2f) leg %d: rode to %.6f m/s, %.3f m; the file says %.6f m/s, %.3f m — run with -update if the model moved on purpose",
					v.Name, v.CdA, j, got.Speed, got.Distance, stored.Speed, stored.Distance)
			}
		}
		if v.Name != want[i].Name || v.CdA != want[i].CdA {
			t.Errorf("vector %d is %q at CdA %.2f, the model defines %q at %.2f: run with -update", i, v.Name, v.CdA, want[i].Name, want[i].CdA)
		}
	}
}

// ADR-0084's rule, pinned by name rather than arity: a gear or the trainer's
// speed slipped in as a sixth argument is exactly what an arity check misses
// once it is defaulted.
func TestStepTakesExactlyWattsGradeMassCdaShelter(t *testing.T) {
	f, err := parser.ParseFile(token.NewFileSet(), "pace.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, d := range f.Decls {
		fn, ok := d.(*ast.FuncDecl)
		if !ok || fn.Name.Name != "Step" || fn.Recv == nil {
			continue
		}
		for _, field := range fn.Type.Params.List {
			for _, n := range field.Names {
				names = append(names, n.Name)
			}
		}
	}
	if want := []string{"watts", "grade", "mass", "cda", "shelter"}; !reflect.DeepEqual(names, want) {
		t.Fatalf("Pace.Step takes %v, want exactly %v", names, want)
	}
}

func TestReferenceRider(t *testing.T) {
	mass := float64(protocol.ReferenceRiderKg + protocol.BikeKg)
	watts := float64(protocol.ReferenceRiderWatts)
	for _, tc := range []struct {
		cda, grade, kmh float64
	}{
		{protocol.PaceDefaultCdA, 0, 35.4},
		{protocol.PaceDefaultCdA, 8, 11.2},
		{0.40, 0, 33.0},
	} {
		if got := SteadySpeed(watts, tc.grade, mass, tc.cda, 0) * 3.6; math.Abs(got-tc.kmh) > 0.05 {
			t.Errorf("CdA %.2f at %.0f %%: %.2f km/h, want %.1f", tc.cda, tc.grade, got, tc.kmh)
		}
	}
	// Stepping settles on the same speed the balance gives.
	p := Pace{}
	for range 600 {
		p.Step(watts, 0, mass, protocol.PaceDefaultCdA, 0)
	}
	if steady := SteadySpeed(watts, 0, mass, protocol.PaceDefaultCdA, 0); !near(p.Speed, steady, 1e-3) {
		t.Errorf("stepped to %.4f m/s, the balance is %.4f", p.Speed, steady)
	}
}

func near(got, want, rel float64) bool {
	return math.Abs(got-want) <= rel*math.Max(math.Abs(want), 1)
}

// hairpinRoad is the golden vector's road: a 10 m hairpin 200 m on.
func hairpinRoad() func(float64) float64 {
	return CornerLimit(curvatureOf([]bend{{FromM: 200, ToM: 200 + math.Pi*10, RadiusM: 10}}), bendStep)
}

// #3204's acceptance: down −8 % at the speed it coasts to, the pace meets a
// 10 m hairpin at no more than 27.6 km/h — a 31° lean, not the 73° the
// unbraked model leant — and starts braking about 32 m before it.
func TestAHairpinIsMetAtItsLimitAndBrakedForAhead(t *testing.T) {
	mass := float64(protocol.ReferenceRiderKg + protocol.BikeKg)
	coast := SteadySpeed(0, -8, mass, protocol.PaceDefaultCdA, 0)
	limit := hairpinRoad()

	// √(0.6·g·10 m) is 7.67 m/s: the issue's 27.6 km/h, to its decimal.
	apex := limit(215)
	if kmh := math.Round(apex*36) / 10; kmh > 27.6 {
		t.Errorf("the hairpin allows %.2f km/h, want at most 27.6", apex*3.6)
	}
	brakesAt := 0.0
	for d := 0.0; d < 200; d += 0.1 {
		if limit(d) < coast {
			brakesAt = d
			break
		}
	}
	if before := 200 - brakesAt; before < 30 || before > 34 {
		t.Errorf("braking starts %.1f m before the hairpin, want about 32", before)
	}

	p := Pace{Speed: coast, Limit: limit}
	braked := false
	inside := 0
	for range 30 {
		p.Step(0, -8, mass, protocol.PaceDefaultCdA, 0)
		braked = braked || p.Braking
		if p.Speed > limit(p.Distance)+1e-9 {
			t.Fatalf("at %.1f m the pace rides %.2f m/s over a limit of %.2f", p.Distance, p.Speed, limit(p.Distance))
		}
		// The bend as the road samples it, every 10 m: 200 to 230 m.
		if p.Distance >= 200 && p.Distance <= 230 {
			inside++
			if p.Speed > apex+1e-9 {
				t.Fatalf("inside the hairpin at %.2f km/h", p.Speed*3.6)
			}
		}
	}
	if inside == 0 {
		t.Error("no second ended inside the hairpin, so nothing above was checked there")
	}
	if !braked {
		t.Error("the pace never said it was braking")
	}
}

// Braking only ever caps: a road that never bends leaves the pace exactly as
// it was, and never says it braked.
func TestAStraightNeverBrakes(t *testing.T) {
	mass := float64(protocol.ReferenceRiderKg + protocol.BikeKg)
	free := Pace{Speed: 3}
	capped := Pace{Speed: 3, Limit: CornerLimit(make([]float64, 200), bendStep)}
	for s := range 300 {
		grade := []float64{-10, 0, 6}[s/100]
		free.Step(400, grade, mass, protocol.PaceDefaultCdA, 0)
		capped.Step(400, grade, mass, protocol.PaceDefaultCdA, 0)
		if capped.Braking || capped.Speed != free.Speed || capped.Distance != free.Distance {
			t.Fatalf("second %d: a straight road braked (%v) or moved the pace: %+v vs %+v", s, capped.Braking, capped, free)
		}
	}
}

// Extra watts never cost time, bend or no bend: the stronger rider is past
// every metre of the hairpin road no later than the weaker one.
func TestExtraWattsNeverLowerSpeed(t *testing.T) {
	mass := float64(protocol.ReferenceRiderKg + protocol.BikeKg)
	arrival := func(watts, grade float64) []int {
		p := Pace{Speed: 5, Limit: hairpinRoad()}
		var at []int
		for s := 1; len(at) < 40 && s < 600; s++ {
			p.Step(watts, grade, mass, protocol.PaceDefaultCdA, 0)
			for len(at) < 40 && p.Distance >= float64(10*(len(at)+1)) {
				at = append(at, s)
			}
		}
		return at
	}
	for _, grade := range []float64{-8, 0, 5} {
		weak, strong := arrival(150, grade), arrival(300, grade)
		for i := range weak {
			if strong[i] > weak[i] {
				t.Fatalf("at %.0f %%: 300 W reached %d m at %d s, 150 W at %d s", grade, 10*(i+1), strong[i], weak[i])
			}
		}
	}
}
