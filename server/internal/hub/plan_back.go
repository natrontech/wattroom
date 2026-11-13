package hub

import (
	"context"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/safego"
)

// PlanKeeper puts a plan back on its crew's calendar (#4562): starting a
// plan marks it started, so a session it opened and cancelled before its
// count-in would otherwise take the plan with it and leave no ride.
// Satisfied by *crews.Service.
type PlanKeeper interface {
	GiveBackPlan(ctx context.Context, crewID, planID string) error
}

// SetPlanKeeper wires the crews' calendar in.
func (h *Hub) SetPlanKeeper(k PlanKeeper) { h.plans = k }

// planBackTimeout bounds one give-back: a write of one row.
const planBackTimeout = 5 * time.Second

// giveBackPlan hands a plan its cancel freed to the keeper, off the lock and
// off the socket's reader. The goroutine ends with the one write.
func (h *Hub) giveBackPlan(rm *channelState) {
	rm.mu.Lock()
	plan := rm.givenBack
	rm.givenBack = ""
	rm.mu.Unlock()
	crew, ok := protocol.CrewOfPlace(rm.channel)
	if plan == "" || h.plans == nil || !ok {
		return
	}
	keeper := h.plans
	safego.Go(h.log, "plan give-back", func() {
		ctx, cancel := context.WithTimeout(context.Background(), planBackTimeout)
		defer cancel()
		if err := keeper.GiveBackPlan(ctx, crew, plan); err != nil {
			h.log.Warn("plan give-back failed", "crew", crew, "channel", rm.channel, "plan", plan, "err", err)
		}
	})
}
