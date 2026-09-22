package rooms

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/store"
)

// found starts a crew for who and hands back its id.
func (h *harness) found(t *testing.T, who, name string) string {
	t.Helper()
	status, body := h.call(t, who, http.MethodPost, "/api/crews", fmt.Sprintf(`{"name":%q}`, name))
	if status != http.StatusCreated {
		t.Fatalf("%s founding %q: %d %v", who, name, status, body)
	}
	id, _ := body["id"].(string)
	return id
}

// A rider with no crew and no invite starts one (#2480): they own it, it is
// named from the start, and it opens with a text and a voice channel — a
// crew with nowhere to ride is one its founder lands in and cannot use.
func TestFoundingACrewOpensItWithAChannelOfEachKind(t *testing.T) {
	h := setup(t)
	id := h.found(t, "alice", "  Night Owls  ")
	crewID, err := store.ParseUUID(id)
	if err != nil {
		t.Fatalf("the crew's id %q: %v", id, err)
	}

	status, body := h.call(t, "alice", http.MethodGet, "/api/crews/"+id, "")
	if status != http.StatusOK || body["name"] != "Night Owls" || body["role"] != "owner" || body["named"] != true {
		t.Fatalf("the founder's read: %d %v", status, body)
	}
	if code, _ := body["code"].(string); len(code) != protocol.CrewCodeLen {
		t.Fatalf("the crew's invite %q is not a crew code", code)
	}

	rows, err := h.store.Queries.ListCrewChannels(t.Context(), crewID)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, c := range rows {
		got = append(got, c.Kind+":"+c.Name)
	}
	if want := "text:Lounge voice:Lounge"; strings.Join(got, " ") != want {
		t.Fatalf("channels %v, want %s", got, want)
	}
}

func TestFoundingACrewRefusesWhatIsNotAName(t *testing.T) {
	h := setup(t)
	for _, tc := range []struct {
		name, who, body string
		status          int
	}{
		{"signed out", "", `{"name":"Night Owls"}`, http.StatusUnauthorized},
		{"no name", "alice", `{"name":"   "}`, http.StatusBadRequest},
		{"too long", "alice", fmt.Sprintf(`{"name":%q}`, strings.Repeat("é", protocol.MaxCrewNameChars+1)), http.StatusBadRequest},
		{"two lines", "alice", `{"name":"Night\nOwls"}`, http.StatusBadRequest},
		{"unknown field", "alice", `{"name":"Night Owls","slug":"x"}`, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, body := h.call(t, tc.who, http.MethodPost, "/api/crews", tc.body)
			if status != tc.status {
				t.Fatalf("%d %v, want %d", status, body, tc.status)
			}
		})
	}
	// Exactly the cap is a name.
	h.found(t, "alice", strings.Repeat("é", protocol.MaxCrewNameChars))
}

// docs/SPEC.md: a rider founds at most MaxFoundedCrews, counted over the
// crews they founded and still own. The crew a first room made counts — it is
// founded too — and handing one on frees the slot.
func TestTheFoundingCapCountsWhatYouFoundedAndStillOwn(t *testing.T) {
	h := setup(t)
	slug, _ := h.createRoom(t, "alice", "Alice's Room")
	for i := 1; i < protocol.MaxFoundedCrews; i++ {
		h.found(t, "alice", fmt.Sprintf("Crew %d", i))
	}

	status, body := h.call(t, "alice", http.MethodPost, "/api/crews", `{"name":"One Too Many"}`)
	if status != http.StatusTooManyRequests || body["error"] != "rate_limited" {
		t.Fatalf("the founding past the cap: %d %v", status, body)
	}
	if msg, _ := body["message"].(string); !strings.Contains(msg, fmt.Sprint(protocol.MaxFoundedCrews)) {
		t.Fatalf("the refusal %q does not name the cap", msg)
	}

	// Handed on: still founded by alice, no longer hers.
	if _, err := h.store.Pool.Exec(t.Context(), "update crews set owner_id = $1 where id = $2",
		h.users.ByToken["bob"].ID, h.crewOf(t, slug).ID); err != nil {
		t.Fatal(err)
	}
	h.found(t, "alice", "Room Again")
}

// The cap holds under a burst: the count runs with the rider's row locked in
// the transaction that inserts, so eight parallel starts found exactly the
// cap's worth and refuse the rest.
func TestTheFoundingCapHoldsUnderParallelStarts(t *testing.T) {
	h := setup(t)
	const burst = 8
	var wg sync.WaitGroup
	var mu sync.Mutex
	created, refused := 0, 0
	for i := range burst {
		wg.Add(1)
		go func() {
			defer wg.Done()
			status, _ := h.call(t, "alice", http.MethodPost, "/api/crews", fmt.Sprintf(`{"name":"Race Crew %d"}`, i))
			mu.Lock()
			defer mu.Unlock()
			switch status {
			case http.StatusCreated:
				created++
			case http.StatusTooManyRequests:
				refused++
			}
		}()
	}
	wg.Wait()
	if created != protocol.MaxFoundedCrews || refused != burst-protocol.MaxFoundedCrews {
		t.Fatalf("%d founded, %d refused; want %d and %d", created, refused, protocol.MaxFoundedCrews, burst-protocol.MaxFoundedCrews)
	}
}
