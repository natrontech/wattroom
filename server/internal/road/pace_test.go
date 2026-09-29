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
	Legs  []leg   `json:"legs"`
}

type golden struct {
	About   string   `json:"about"`
	Vectors []vector `json:"vectors"`
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
		)
	}
	return out
}

// ride replays a vector's legs through Pace and returns them with where each ended.
func ride(v vector) []leg {
	p := Pace{Speed: v.Speed}
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
