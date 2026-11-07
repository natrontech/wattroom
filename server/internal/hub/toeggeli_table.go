package hub

import (
	"math"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// The table football's numbers (docs/spec/lounge.md). The table runs 0 to 1
// along and 0 to 1 across; the left rider defends x = 0.
const (
	toeggeliHz        = 30
	toeggeliGoals     = 5
	toeggeliMatchMs   = 180_000
	toeggeliGoalMs    = 1_500
	toeggeliOverMs    = 4_000
	toeggeliBall      = 0.025
	toeggeliMouth     = 0.18 // half the goal's width, about the middle
	toeggeliKickOff   = 0.35 // the ball's speed from the middle, tables a second
	toeggeliShot      = 1.25 // a kick
	toeggeliPush      = 0.55 // a touch without one
	toeggeliTop       = 1.6  // the fastest a ball goes
	toeggeliSlowest   = 0.22 // a rolling ball never stops dead
	toeggeliDrag      = 0.35 // speed lost a second, as a share
	toeggeliManX      = 0.018
	toeggeliManY      = 0.045
	toeggeliKeeperX   = 0.08
	toeggeliForwardX  = 0.62
	toeggeliForwardDY = 0.27
)

// table is a match's state. The hub holds it under the channel's lock.
type table struct {
	state protocol.ToeggeliState
	// The ball's velocity, tables a second.
	vx, vy float64
	// Milliseconds the current goal or result has shown.
	pause int64
	// Which side kicks off next: -1 toward the left, 1 toward the right.
	serve float64
}

func newTable(left, leftName, right, rightName string) *table {
	t := &table{serve: 1, state: protocol.ToeggeliState{
		Left: left, LeftName: leftName, Right: right, RightName: rightName,
		LeftY: 0.5, RightY: 0.5, LeftMs: toeggeliMatchMs, Phase: protocol.ToeggeliPlay,
	}}
	t.kickOff()
	return t
}

// kickOff puts the ball in the middle, rolling toward whoever lost the last goal.
func (t *table) kickOff() {
	t.state.BallX, t.state.BallY = 0.5, 0.5
	t.vx, t.vy = t.serve*toeggeliKickOff, 0.12*t.serve
}

// men are a side's figures, where they stand now: a keeper, then three forwards.
func men(rodY float64, left bool) [4][2]float64 {
	keeperX, forwardX := toeggeliKeeperX, toeggeliForwardX
	if !left {
		keeperX, forwardX = 1-keeperX, 1-forwardX
	}
	keeper := 0.12 + 0.76*rodY
	mid := 0.3 + 0.4*rodY
	return [4][2]float64{
		{keeperX, keeper},
		{forwardX, mid - toeggeliForwardDY},
		{forwardX, mid},
		{forwardX, mid + toeggeliForwardDY},
	}
}

// step runs the table on by dt seconds. It reports a goal or the end, once.
func (t *table) step(dt float64) (goal, over bool) {
	s := &t.state
	ms := int64(dt * 1000)
	switch s.Phase {
	case protocol.ToeggeliOver:
		t.pause += ms
		return false, false
	case protocol.ToeggeliGoal:
		t.pause += ms
		if t.pause >= toeggeliGoalMs {
			t.pause = 0
			s.Phase = protocol.ToeggeliPlay
			t.kickOff()
		}
		return false, false
	}
	s.LeftMs = max(0, s.LeftMs-ms)
	if s.LeftMs == 0 {
		t.finish()
		return false, true
	}
	s.BallX += t.vx * dt
	s.BallY += t.vy * dt
	// The side walls.
	if s.BallY < toeggeliBall {
		s.BallY, t.vy = toeggeliBall, math.Abs(t.vy)
	} else if s.BallY > 1-toeggeliBall {
		s.BallY, t.vy = 1-toeggeliBall, -math.Abs(t.vy)
	}
	// The ends: a goal through the mouth, the wall beside it.
	inMouth := math.Abs(s.BallY-0.5) < toeggeliMouth
	if s.BallX < 0 && inMouth {
		return t.scored(false)
	}
	if s.BallX > 1 && inMouth {
		return t.scored(true)
	}
	if s.BallX < toeggeliBall && !inMouth {
		s.BallX, t.vx = toeggeliBall, math.Abs(t.vx)
	} else if s.BallX > 1-toeggeliBall && !inMouth {
		s.BallX, t.vx = 1-toeggeliBall, -math.Abs(t.vx)
	}
	// The figures: a touch sends the ball on toward the other goal, a kick hard.
	t.touch(men(s.LeftY, true), 1, s.LeftKick)
	t.touch(men(s.RightY, false), -1, s.RightKick)
	// Drag, never to a stop, and never past the fastest.
	speed := math.Hypot(t.vx, t.vy)
	want := math.Min(toeggeliTop, math.Max(toeggeliSlowest, speed*(1-toeggeliDrag*dt)))
	if speed > 0 {
		t.vx, t.vy = t.vx*want/speed, t.vy*want/speed
	}
	return false, false
}

// touch plays the ball off a side's figures: toward is the way they shoot.
func (t *table) touch(side [4][2]float64, toward float64, kick bool) {
	s := &t.state
	for _, m := range side {
		dx, dy := s.BallX-m[0], s.BallY-m[1]
		if math.Abs(dx) > toeggeliManX+toeggeliBall || math.Abs(dy) > toeggeliManY+toeggeliBall {
			continue
		}
		speed := toeggeliPush
		if kick {
			speed = toeggeliShot
		}
		speed = math.Max(speed, math.Hypot(t.vx, t.vy)*0.8)
		// Off the figure's edge the ball goes wide; off its middle, straight.
		angle := dy / (toeggeliManY + toeggeliBall) * 0.9
		t.vx, t.vy = toward*speed*math.Cos(angle), speed*math.Sin(angle)
		// Out of the figure, on the side it is going.
		s.BallX = m[0] + toward*(toeggeliManX+toeggeliBall+0.001)
		return
	}
}

// scored counts a goal for the left side or the right, and ends the match at five.
func (t *table) scored(left bool) (goal, over bool) {
	s := &t.state
	if left {
		s.LeftGoals++
		t.serve = -1
	} else {
		s.RightGoals++
		t.serve = 1
	}
	s.BallX, s.BallY = 0.5, 0.5
	t.vx, t.vy = 0, 0
	if s.LeftGoals >= toeggeliGoals || s.RightGoals >= toeggeliGoals {
		t.finish()
		return true, true
	}
	s.Phase = protocol.ToeggeliGoal
	t.pause = 0
	return true, false
}

// finish ends the match: more goals win, the same is a draw.
func (t *table) finish() {
	s := &t.state
	s.Phase = protocol.ToeggeliOver
	t.pause = 0
	switch {
	case s.LeftGoals > s.RightGoals:
		s.Winner = s.Left
	case s.RightGoals > s.LeftGoals:
		s.Winner = s.Right
	}
}

// done reports whether the result has shown long enough to clear the table.
func (t *table) done() bool {
	return t.state.Phase == protocol.ToeggeliOver && t.pause >= toeggeliOverMs
}

// move takes a player's rods and button. Anything off the table is clamped:
// it is a client's word, and a NaN is the top of the table.
func (t *table) move(rider string, y float64, kick bool) {
	if math.IsNaN(y) {
		y = 0
	}
	y = math.Min(1, math.Max(0, y))
	switch rider {
	case t.state.Left:
		t.state.LeftY, t.state.LeftKick = y, kick
	case t.state.Right:
		t.state.RightY, t.state.RightKick = y, kick
	}
}
