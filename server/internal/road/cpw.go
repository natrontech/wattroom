package road

import (
	"math"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// CPW is a rider's critical power and W′ (#3262): the one model the matches
// gauge, the devil (#3170) and a pacer read, twinned as $lib/road/cpw.ts and
// held to the same golden vectors.
type CPW struct {
	// CP is the power a rider holds without drawing on W′, in watts.
	CP float64
	// WPrime is the work above CP a rider has to spend, in joules.
	WPrime float64
	// Estimate: fitted from the 5- and 20-minute bests, because the 90-day
	// curve lacks a 3- or 12-minute one.
	Estimate bool
}

// FitCPW fits the two-point model to a rider's 90-day bests, in watts (0 is
// none): from 3 and 12 minutes, else from 5 and 20 flagged an estimate. False
// when neither pair holds a W′ to fit — a shorter best no higher than the
// longer one.
func FitCPW(best3m, best12m, best5m, best20m float64) (CPW, bool) {
	if fit, ok := twoPoint(best3m, protocol.CPShortSeconds, best12m, protocol.CPLongSeconds); ok {
		return fit, true
	}
	fit, ok := twoPoint(best5m, protocol.CPEstimateShortSeconds, best20m, protocol.CPEstimateLongSeconds)
	fit.Estimate = true
	return fit, ok
}

// twoPoint puts both bests on the hyperbola P = CP + W′/t:
// W′ = (P1 − P2)·t1·t2 / (t2 − t1), CP = P1 − W′/t1 (RESEARCH §13.1).
func twoPoint(p1, t1, p2, t2 float64) (CPW, bool) {
	if p1 <= 0 || p2 <= 0 || p1 <= p2 {
		return CPW{}, false
	}
	w := (p1 - p2) * t1 * t2 / (t2 - t1)
	return CPW{CP: p1 - w/t1, WPrime: w}, true
}

// WBal is a rider's W′ balance through a ride, a second at a time (#3262):
// Skiba's differential model (Skiba et al. 2015). Above CP the balance spends
// exactly what the rider rides over it; below, it recovers towards W′ with
// the time constant W′ / (CP − P), so the further under CP, the faster.
// Nothing clamps it at zero — a rider can ride through empty, and the gauge
// is the one to say so.
type WBal struct {
	Model   CPW
	Balance float64
}

// NewWBal starts a ride with W′ whole.
func NewWBal(m CPW) *WBal { return &WBal{Model: m, Balance: m.WPrime} }

// Step advances the balance one second at these watts.
func (w *WBal) Step(watts float64) {
	if watts >= w.Model.CP {
		w.Balance -= watts - w.Model.CP
		return
	}
	spent := w.Model.WPrime - w.Balance
	w.Balance = w.Model.WPrime - spent*math.Exp(-(w.Model.CP-watts)/w.Model.WPrime)
}
