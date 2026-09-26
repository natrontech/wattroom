package hub

// A session whose coach has gone passes to whoever has ridden in it longest
// (#2636, decided 2026-09-24), and every change of coach says so on the
// channel's timeline.

import (
	"testing"
	"time"

	"github.com/natrontech/wattroom/server/internal/protocol"
)

// passRoom is a channel on a hand-moved clock, a session Ana opened and
// started, and the riders' sockets by id.
func passRoom(t *testing.T, now *time.Time, riders ...protocol.Rider) (*room, map[string]*client) {
	t.Helper()
	rm := presenceRoom(now)
	clients := map[string]*client{}
	for _, rider := range riders {
		c := &client{rider: rider, out: make(chan []byte, clientQueue)}
		rm.join(c)
		clients[rider.ID] = c
	}
	for _, c := range []protocol.Control{openers, {Action: "start"}} {
		if code, message := rm.control(c, riders[0], *now); code != "" {
			t.Fatalf("%s: %s %s", c.Action, code, message)
		}
	}
	for _, rider := range riders {
		joinRide(rm, rider.ID)
	}
	return rm, clients
}

// sampleFrom is one sample from each rider, in this order, at the room's now.
func sampleFrom(rm *room, clients map[string]*client, ids ...string) {
	for _, id := range ids {
		rm.setMetrics(clients[id], protocol.RiderMetrics{Watts: 150, Cadence: 90, Seq: 1})
	}
}

func sweep(rm *room, now time.Time) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.sayDepartedLocked(now)
}

func coachOf(rm *room) string { return rm.session.coach }

func TestCoachGonePassesSession(t *testing.T) {
	ana, ben, cat := protocol.Rider{ID: "ana", Name: "Ana"}, protocol.Rider{ID: "ben", Name: "Ben"}, protocol.Rider{ID: "cat", Name: "Cat"}
	pastGrace := int(presenceGrace.Seconds()) + 1

	t.Run("to whoever rode first", func(t *testing.T) {
		now := pat(0)
		rm, clients := passRoom(t, &now, ana, ben, cat)
		sampleFrom(rm, clients, "cat", "ben")
		rm.leave(clients["ana"])
		rm.events.drain()

		now = pat(pastGrace - 2)
		sampleFrom(rm, clients, "ben", "cat")
		sweep(rm, now)
		if coachOf(rm) != "ana" {
			t.Fatalf("passed inside the grace window, to %q", coachOf(rm))
		}

		now = pat(pastGrace)
		sweep(rm, now)
		if coachOf(rm) != "cat" || rm.session.coachName != "Cat" {
			t.Fatalf("coach is %q (%q), want Cat, who rode first", coachOf(rm), rm.session.coachName)
		}
		if got := verbs(rm); len(got) != 2 || got[0] != "left:Ana" || got[1] != "passedOn:Ana" {
			t.Fatalf("lines: %v, want Ana's leave and then the pass", got)
		}
		if subject := rm.events.pending[1].Subject; subject != "Cat" {
			t.Fatalf("the pass names %q, want Cat", subject)
		}
	})

	t.Run("skips a rider who left too", func(t *testing.T) {
		now := pat(0)
		rm, clients := passRoom(t, &now, ana, ben, cat)
		sampleFrom(rm, clients, "cat", "ben")
		rm.leave(clients["cat"])
		rm.leave(clients["ana"])
		now = pat(pastGrace)
		sampleFrom(rm, clients, "ben")
		sweep(rm, now)
		if coachOf(rm) != "ben" {
			t.Fatalf("coach is %q, want Ben — Cat left as well", coachOf(rm))
		}
	})

	// Leave the ride is explicit (ADR-0059): pedalling beside the session,
	// they are a free rider now, not a coach in waiting (#2829).
	t.Run("skips a rider who left the ride", func(t *testing.T) {
		now := pat(0)
		rm, clients := passRoom(t, &now, ana, ben, cat)
		sampleFrom(rm, clients, "cat") // rode it first, so longest
		if code, message := rm.control(protocol.Control{Action: "leave"}, cat, now); code != "" {
			t.Fatalf("leave: %s %s", code, message)
		}
		rm.leave(clients["ana"])
		now = pat(pastGrace)
		sampleFrom(rm, clients, "cat", "ben")
		sweep(rm, now)
		if coachOf(rm) != "ben" {
			t.Fatalf("coach is %q, want Ben — Cat left the ride", coachOf(rm))
		}
	})

	t.Run("stays with nobody riding", func(t *testing.T) {
		now := pat(0)
		rm, clients := passRoom(t, &now, ana, ben)
		sampleFrom(rm, clients, "ben") // then stops: older than ridingWindow by the sweep
		rm.leave(clients["ana"])
		now = pat(pastGrace)
		sweep(rm, now)
		if coachOf(rm) != "ana" {
			t.Fatalf("passed to %q, who is not riding", coachOf(rm))
		}
	})

	t.Run("a coach who flaps back keeps it", func(t *testing.T) {
		now := pat(0)
		rm, clients := passRoom(t, &now, ana, ben)
		rm.leave(clients["ana"])
		now = pat(pastGrace - 5)
		rm.join(&client{rider: ana, out: make(chan []byte, clientQueue)})
		sampleFrom(rm, clients, "ben")
		now = pat(pastGrace)
		sweep(rm, now)
		if coachOf(rm) != "ana" {
			t.Fatalf("passed to %q while Ana was back", coachOf(rm))
		}
	})

	t.Run("not after the session is done", func(t *testing.T) {
		now := pat(0)
		rm, clients := passRoom(t, &now, ana, ben)
		sampleFrom(rm, clients, "ben")
		// Ended once it ran: a stopped countdown drops the session (#2605).
		if code, message := rm.control(protocol.Control{Action: "end"}, ana, pat(countdownSeconds+1)); code != "" {
			t.Fatalf("end: %s %s", code, message)
		}
		rm.leave(clients["ana"])
		now = pat(pastGrace)
		sampleFrom(rm, clients, "ben")
		sweep(rm, now)
		if coachOf(rm) != "ana" {
			t.Fatalf("a done session changed coach, to %q", coachOf(rm))
		}
	})
}

func TestHandOffSaysSo(t *testing.T) {
	now := pat(0)
	ana, ben := protocol.Rider{ID: "ana", Name: "Ana"}, protocol.Rider{ID: "ben", Name: "Ben"}
	rm, _ := passRoom(t, &now, ana, ben)
	rm.events.drain()
	if code, message := rm.control(protocol.Control{Action: "handoff", Rider: "ben"}, ana, now); code != "" {
		t.Fatalf("handoff: %s %s", code, message)
	}
	if got := verbs(rm); len(got) != 1 || got[0] != "handedOff:Ana" || rm.events.pending[0].Subject != "Ben" {
		t.Fatalf("lines: %v, want Ana handing it to Ben", got)
	}
}
