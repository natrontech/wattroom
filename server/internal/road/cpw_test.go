package road

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

// The file both twins read (#3262). Regenerate it with
// `go test ./internal/road -run TestCPWGolden -update` whenever the model or
// its constants move, and commit it: web/src/lib/road/cpw.test.ts replays it.
const cpwGoldenPath = "../protocol/testdata/cpw-golden.json"

type cpwFit struct {
	Best3m   float64 `json:"best3m"`
	Best12m  float64 `json:"best12m"`
	Best5m   float64 `json:"best5m"`
	Best20m  float64 `json:"best20m"`
	OK       bool    `json:"ok"`
	CP       float64 `json:"cp"`
	WPrime   float64 `json:"wPrime"`
	Estimate bool    `json:"estimate"`
}

type cpwLeg struct {
	Seconds int     `json:"seconds"`
	Watts   float64 `json:"watts"`
	Balance float64 `json:"balance"` // joules at the end of the leg
}

type cpwTrace struct {
	Name   string   `json:"name"`
	CP     float64  `json:"cp"`
	WPrime float64  `json:"wPrime"`
	Legs   []cpwLeg `json:"legs"`
}

type cpwGolden struct {
	About  string     `json:"about"`
	Fits   []cpwFit   `json:"fits"`
	Traces []cpwTrace `json:"traces"`
}

// The inputs; -update fills in what the model answers.
func cpwInputs() ([]cpwFit, []cpwTrace) {
	fits := []cpwFit{
		{Best3m: 400, Best12m: 300},                            // the worked example below
		{Best3m: 520, Best12m: 390, Best5m: 470, Best20m: 360}, // a strong rider, both pairs held
		{Best12m: 300, Best5m: 350, Best20m: 280},              // no 3-minute best: the estimate
		{Best3m: 400, Best5m: 350, Best20m: 280},               // no 12-minute best: the estimate
		{Best3m: 300, Best12m: 300, Best5m: 330, Best20m: 290}, // a flat 3/12 pair holds no W′
		{Best3m: 300, Best12m: 300},                            // nothing to fit at all
		{},                                                     // a rider with no curve
	}
	traces := []cpwTrace{
		{Name: "over CP, then recovering below it", CP: 250, WPrime: 20_000,
			Legs: []cpwLeg{{Seconds: 100, Watts: 300}, {Seconds: 200, Watts: 150}}},
		{Name: "intervals: 3 × (60 s at 400 W, 60 s at 120 W)", CP: 266.6, WPrime: 24_000,
			Legs: []cpwLeg{
				{Seconds: 60, Watts: 400}, {Seconds: 60, Watts: 120},
				{Seconds: 60, Watts: 400}, {Seconds: 60, Watts: 120},
				{Seconds: 60, Watts: 400}, {Seconds: 60, Watts: 120},
			}},
		{Name: "riding through empty", CP: 200, WPrime: 10_000,
			Legs: []cpwLeg{{Seconds: 120, Watts: 300}, {Seconds: 30, Watts: 0}}},
	}
	return fits, traces
}

func traceOf(tr cpwTrace) []cpwLeg {
	w := NewWBal(CPW{CP: tr.CP, WPrime: tr.WPrime})
	out := make([]cpwLeg, len(tr.Legs))
	for i, l := range tr.Legs {
		for range l.Seconds {
			w.Step(l.Watts)
		}
		l.Balance = w.Balance
		out[i] = l
	}
	return out
}

func TestCPWGolden(t *testing.T) {
	fits, traces := cpwInputs()
	if *update {
		g := cpwGolden{About: "The critical-power model's golden vectors (#3262), written by `go test ./internal/road -run TestCPWGolden -update` and replayed by web/src/lib/road/cpw.test.ts; the two twins agree within 0.1 %."}
		for _, f := range fits {
			m, ok := FitCPW(f.Best3m, f.Best12m, f.Best5m, f.Best20m)
			f.OK, f.CP, f.WPrime, f.Estimate = ok, m.CP, m.WPrime, m.Estimate
			g.Fits = append(g.Fits, f)
		}
		for _, tr := range traces {
			tr.Legs = traceOf(tr)
			g.Traces = append(g.Traces, tr)
		}
		raw, err := json.MarshalIndent(g, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(cpwGoldenPath, append(raw, '\n'), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(cpwGoldenPath)
	if err != nil {
		t.Fatalf("read %s: %v (run with -update to write it)", cpwGoldenPath, err)
	}
	var g cpwGolden
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	if len(g.Fits) != len(fits) || len(g.Traces) != len(traces) {
		t.Fatalf("the file holds %d fits and %d traces, the model defines %d and %d: run with -update", len(g.Fits), len(g.Traces), len(fits), len(traces))
	}
	for _, f := range g.Fits {
		m, ok := FitCPW(f.Best3m, f.Best12m, f.Best5m, f.Best20m)
		if ok != f.OK || !near(m.CP, f.CP, 1e-12) || !near(m.WPrime, f.WPrime, 1e-12) || m.Estimate != f.Estimate {
			t.Errorf("FitCPW(%v, %v, %v, %v) = %+v %v; the file says %+v — run with -update if the model moved on purpose",
				f.Best3m, f.Best12m, f.Best5m, f.Best20m, m, ok, f)
		}
	}
	for _, tr := range g.Traces {
		for i, got := range traceOf(tr) {
			if !near(got.Balance, tr.Legs[i].Balance, 1e-12) {
				t.Errorf("%s, leg %d: %.3f J; the file says %.3f", tr.Name, i, got.Balance, tr.Legs[i].Balance)
			}
		}
	}
}

// A worked example, by hand: 400 W for 3 min and 300 W for 12 min put
// W′ = (400 − 300)·180·720/540 = 24 kJ and CP = 400 − 24000/180 = 266.7 W,
// and both bests sit on P = CP + W′/t.
func TestTwoPointFitIsTheHyperbolaThroughBothBests(t *testing.T) {
	m, ok := FitCPW(400, 300, 0, 0)
	if !ok || m.Estimate || !near(m.WPrime, 24_000, 1e-12) || !near(m.CP, 800.0/3, 1e-12) {
		t.Fatalf("FitCPW(400, 300) = %+v %v, want CP 266.7 W and W′ 24 kJ, not an estimate", m, ok)
	}
	for _, p := range []struct{ t, watts float64 }{{180, 400}, {720, 300}} {
		if got := m.CP + m.WPrime/p.t; !near(got, p.watts, 1e-12) {
			t.Errorf("the hyperbola at %.0f s is %.3f W, the best was %.0f", p.t, got, p.watts)
		}
	}
}

// Until the 90-day curve holds both a 3- and a 12-minute best, the model
// fits the 5/20 pair and says it is an estimate.
func TestTheFallbackFlagsItself(t *testing.T) {
	for _, c := range []struct {
		name                             string
		best3m, best12m, best5m, best20m float64
	}{
		{"no 3-minute best", 0, 300, 350, 280},
		{"no 12-minute best", 400, 0, 350, 280},
		{"a 3/12 pair with no W′ in it", 300, 300, 350, 280},
	} {
		m, ok := FitCPW(c.best3m, c.best12m, c.best5m, c.best20m)
		// (350 − 280)·300·1200/900 = 28 kJ; 350 − 28000/300 = 256.7 W.
		if !ok || !m.Estimate || !near(m.WPrime, 28_000, 1e-12) || !near(m.CP, 770.0/3, 1e-12) {
			t.Errorf("%s: %+v %v, want the 5/20 estimate, CP 256.7 W and W′ 28 kJ", c.name, m, ok)
		}
	}
	if m, ok := FitCPW(0, 0, 0, 0); ok {
		t.Errorf("a rider with no curve fitted %+v", m)
	}
}

// Skiba's differential model, checked by what it is: above CP it spends
// exactly the watts over CP; below it, one time constant W′/(CP − P) gives
// back 1 − 1/e of what was spent; at CP nothing moves.
func TestWBalSpendsAboveCPAndRecoversBelow(t *testing.T) {
	w := NewWBal(CPW{CP: 250, WPrime: 20_000})
	for range 100 {
		w.Step(300)
	}
	if !near(w.Balance, 15_000, 1e-12) {
		t.Fatalf("100 s at 50 W over CP left %.3f J, want 15000", w.Balance)
	}
	for range 200 { // τ = 20000 / (250 − 150)
		w.Step(150)
	}
	if want := 20_000 - 5_000*math.Exp(-1); !near(w.Balance, want, 1e-9) {
		t.Fatalf("one time constant below CP recovered to %.3f J, want %.3f", w.Balance, want)
	}
	held := w.Balance
	for range 60 {
		w.Step(250)
	}
	if w.Balance != held {
		t.Fatalf("riding at CP moved the balance from %.3f to %.3f", held, w.Balance)
	}
}
