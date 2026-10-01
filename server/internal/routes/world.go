package routes

import (
	"context"
	"net/http"

	"github.com/natrontech/wattroom/server/internal/httpx"
	"github.com/natrontech/wattroom/server/internal/protocol"
	"github.com/natrontech/wattroom/server/internal/road"
)

// A world's secrets (#3225, ADR-0081): every keyed choice a world makes is a
// hash of a secret salt, and a salt anyone can read matches a photo to its
// place. The secrets derive from the one world key; a route's goes to every
// rider it is served to, a private region's to its owner alone, the world's
// to every signed-in rider.

// regionJSON is one private region as the owner's /shape serves it: where it
// lies on the road and its owner-only secret — $lib/world/place's
// onStroke(stroke, {fromM, toM, salt}).
type regionJSON struct {
	Kind   string  `json:"kind"`
	FromM  float64 `json:"fromM"`
	ToM    float64 `json:"toM"`
	Secret []byte  `json:"secret"`
}

func (s *Service) worldKey(ctx context.Context) (road.WorldKey, error) {
	key, err := s.store.Queries.GetWorldKey(ctx)
	return road.WorldKey(key), err
}

// hiddenEnds are a route's private regions until zones ship (#3132): ADR-0063's
// default RouteHiddenEndM at both ends, each with its own secret.
func hiddenEnds(key road.WorldKey, route string, lengthM float64) []regionJSON {
	end := float64(protocol.RouteHiddenEndM)
	return []regionJSON{
		{Kind: "end", FromM: 0, ToM: end, Secret: key.RegionSecret("end", route+"/start")},
		{Kind: "end", FromM: lengthM - end, ToM: lengthM, Secret: key.RegionSecret("end", route+"/finish")},
	}
}

// handleWorld is the world's secret, for every signed-in rider: the salt of
// the shared world outside every private region (ADR-0081, accepted).
func (s *Service) handleWorld(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.users.RequireUser(w, r, "Sign in to ride the world."); !ok {
		return
	}
	key, err := s.worldKey(r.Context())
	if err != nil {
		httpx.Fail(w, s.log, "world key read failed", err, "The world could not be loaded. Try again.")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string][]byte{"secret": key.WorldSecret()})
}
