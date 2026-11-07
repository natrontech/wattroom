package hub

import (
	"math"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

const frame = 1.0 / toeggeliHz

func TestTableGoalsAndWalls(t *testing.T) {
	for _, tc := range []struct {
		name           string
		x, y, vx, vy   float64
		leftGoal, wall bool
	}{
		{name: "into the right goal", x: 0.99, y: 0.5, vx: 1, leftGoal: true},
		{name: "into the left goal", x: 0.01, y: 0.5, vx: -1},
		{name: "off the end wall beside the goal", x: 0.99, y: 0.1, vx: 1, wall: true},
		{name: "off a side wall", x: 0.3, y: 0.99, vy: 1, wall: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tb := newTable("l", "L", "r", "R")
			// The rods out of the way: both at the top.
			tb.state.LeftY, tb.state.RightY = 0, 0
			tb.state.BallX, tb.state.BallY, tb.vx, tb.vy = tc.x, tc.y, tc.vx, tc.vy
			goal, _ := tb.step(frame)
			if tc.wall {
				if goal || tb.state.LeftGoals+tb.state.RightGoals != 0 {
					t.Fatalf("a wall scored: %+v", tb.state)
				}
				if tb.state.BallX < 0 || tb.state.BallX > 1 || tb.state.BallY < 0 || tb.state.BallY > 1 {
					t.Fatalf("the ball left the table: %+v", tb.state)
				}
				return
			}
			if !goal || tb.state.Phase != protocol.ToeggeliGoal {
				t.Fatalf("no goal: %+v", tb.state)
			}
			if (tb.state.LeftGoals == 1) != tc.leftGoal {
				t.Fatalf("the wrong side scored: %+v", tb.state)
			}
		})
	}
}

func TestTableKeeperSavesAndShoots(t *testing.T) {
	tb := newTable("l", "L", "r", "R")
	keeper := men(0.5, true)[0]
	tb.state.LeftY, tb.state.LeftKick = 0.5, true
	tb.state.BallX, tb.state.BallY, tb.vx, tb.vy = keeper[0]+0.05, keeper[1], -0.6, 0
	// A few frames: long enough to reach the keeper, not the forwards beyond.
	for range 3 {
		tb.step(frame)
	}
	if tb.state.RightGoals != 0 || tb.vx <= 0 {
		t.Fatalf("the keeper let it by: %+v vx %.2f", tb.state, tb.vx)
	}
	if math.Hypot(tb.vx, tb.vy) < toeggeliShot*0.8 {
		t.Fatalf("a kick went out soft: %.2f", math.Hypot(tb.vx, tb.vy))
	}
}

func TestTableEndsAtFiveOrTheClock(t *testing.T) {
	tb := newTable("l", "L", "r", "R")
	tb.state.LeftGoals = 4
	tb.state.LeftY, tb.state.RightY = 0, 0
	tb.state.BallX, tb.state.BallY, tb.vx, tb.vy = 0.99, 0.5, 1, 0
	if _, over := tb.step(frame); !over || tb.state.Winner != "l" || tb.state.Phase != protocol.ToeggeliOver {
		t.Fatalf("five goals did not win it: %+v", tb.state)
	}
	for tb.pause < toeggeliOverMs {
		tb.step(frame)
	}
	if !tb.done() {
		t.Fatal("the result never cleared")
	}

	draw := newTable("l", "L", "r", "R")
	draw.state.LeftMs = 10
	if _, over := draw.step(frame); !over || draw.state.Winner != "" {
		t.Fatalf("a level match at the whistle is a draw: %+v", draw.state)
	}
}

func TestTableMoveIsClamped(t *testing.T) {
	tb := newTable("l", "L", "r", "R")
	for _, tc := range []struct{ in, want float64 }{
		{math.NaN(), 0}, {-3, 0}, {7, 1}, {0.4, 0.4},
	} {
		tb.move("l", tc.in, false)
		if tb.state.LeftY != tc.want {
			t.Errorf("move %v: rods at %v, want %v", tc.in, tb.state.LeftY, tc.want)
		}
	}
	tb.move("someone else", 0.9, true)
	if tb.state.RightY != 0.5 || tb.state.RightKick {
		t.Errorf("a spectator moved a rod: %+v", tb.state)
	}
}

func TestTableBallStaysOnTheTable(t *testing.T) {
	tb := newTable("l", "L", "r", "R")
	for i := range toeggeliHz * 60 {
		tb.move("l", 0.5+0.5*math.Sin(float64(i)/17), i%9 == 0)
		tb.move("r", 0.5+0.5*math.Sin(float64(i)/23), i%7 == 0)
		tb.step(frame)
		s := tb.state
		if s.BallY < 0 || s.BallY > 1 || math.IsNaN(s.BallX) || math.Hypot(tb.vx, tb.vy) > toeggeliTop+1e-9 {
			t.Fatalf("step %d: %+v v %.2f,%.2f", i, s, tb.vx, tb.vy)
		}
	}
}
