package gamify

import (
	"context"
	"slices"
	"sync"
	"testing"
	"testing/synctest"
	"time"
)

type fakeVoice struct {
	mu      sync.Mutex
	present []string
}

func (f *fakeVoice) VoiceRiderIDs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.present)
}

func (f *fakeVoice) set(ids ...string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.present = ids
}

// fakeLedger records who was paid a block and at which minute.
type fakeLedger struct {
	mu     sync.Mutex
	blocks []string
}

func (f *fakeLedger) LoungeBlock(_ context.Context, riderID string, at time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.blocks = append(f.blocks, riderID+"@"+at.UTC().Format("15:04"))
}

func (f *fakeLedger) paid() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.blocks)
}

// Five FULL minutes pay a block; leaving resets the count; two blocks in
// the same wall minute cannot happen, so the minute is the idempotency ref.
func TestVoiceClockPaysFiveFullMinutes(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		voice := &fakeVoice{}
		voice.set("kim", "lena")
		ledger := &fakeLedger{}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		start := time.Now().UTC()
		go runVoiceClock(ctx, voice, ledger, time.Now)

		time.Sleep(4 * time.Minute)
		synctest.Wait()
		if got := ledger.paid(); len(got) != 0 {
			t.Fatalf("paid after four minutes: %v", got)
		}

		// Lena leaves before her fifth minute; Kim stays.
		voice.set("kim")
		time.Sleep(time.Minute)
		synctest.Wait()
		five := start.Add(5 * time.Minute).Format("15:04")
		if got := ledger.paid(); !slices.Equal(got, []string{"kim@" + five}) {
			t.Fatalf("after five minutes paid %v, want kim only at %s", got, five)
		}

		// Lena is back: her count starts over — four more minutes pay her
		// nothing while Kim's second block lands.
		voice.set("kim", "lena")
		time.Sleep(4 * time.Minute)
		synctest.Wait()
		if got := ledger.paid(); len(got) != 1 {
			t.Fatalf("returning rider paid early: %v", got)
		}
		time.Sleep(time.Minute)
		synctest.Wait()
		ten := start.Add(10 * time.Minute).Format("15:04")
		want := []string{"kim@" + five, "kim@" + ten, "lena@" + ten}
		if got := ledger.paid(); !slices.Equal(got, want) {
			t.Fatalf("paid %v, want %v", got, want)
		}

		// Nobody on the call: the clock keeps ticking, pays nobody.
		voice.set()
		time.Sleep(10 * time.Minute)
		synctest.Wait()
		if got := ledger.paid(); len(got) != 3 {
			t.Fatalf("empty channel paid: %v", got)
		}
	})
}
