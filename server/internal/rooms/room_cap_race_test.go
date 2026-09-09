package rooms

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
)

// docs/SPEC.md's three-room cap holds under a burst (#1413): the count runs
// with the rider's row locked, in the transaction that inserts, so eight
// parallel creates yield three rooms and five refusals — not eight rooms.
func TestTheOwnedRoomCapHoldsUnderParallelCreates(t *testing.T) {
	h := setup(t)
	const burst = 8
	var wg sync.WaitGroup
	var mu sync.Mutex
	created, refused := 0, 0
	for i := 0; i < burst; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			status, _ := h.call(t, "alice", http.MethodPost, "/api/rooms", fmt.Sprintf(`{"name":"Race Room %d"}`, i))
			mu.Lock()
			defer mu.Unlock()
			switch status {
			case http.StatusCreated:
				created++
			case http.StatusConflict:
				refused++
			}
		}(i)
	}
	wg.Wait()
	if created != maxOwnedRooms || refused != burst-maxOwnedRooms {
		t.Fatalf("%d created, %d refused; want %d and %d", created, refused, maxOwnedRooms, burst-maxOwnedRooms)
	}
}
