package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/crews"
	"github.com/natrontech/wattroom/server/internal/customworkouts"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/store/storetest"
	"github.com/natrontech/wattroom/server/internal/testx"
	"github.com/natrontech/wattroom/server/internal/tokens"
)

// fakeTokens knows two tokens: wrt_ok reads, wrt_plan was marked for
// planning (#4207).
type fakeTokens struct{ user *db.User }

func (f *fakeTokens) FromRequest(r *http.Request) (db.User, bool) {
	if f.user == nil || r.Header.Get("Authorization") != "Bearer wrt_ok" && !f.CanWrite(r) {
		return db.User{}, false
	}
	return *f.user, true
}

func (f *fakeTokens) CanWrite(r *http.Request) bool {
	return r.Header.Get("Authorization") == "Bearer wrt_plan"
}

// setup returns the mux, and the store and rider behind it — a paging test
// has to write rides the tools then read.
func setup(t *testing.T) (*http.ServeMux, *store.Store, db.User) {
	t.Helper()
	st := storetest.Open(t)
	u, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{
		DisplayName: "alice", FtpWatts: 250, WeightKg: 70,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", u.ID)
	})
	// The shelf and the schedule, signed in the way wire.go signs them in, so
	// the planning tools run the real handlers. No cookie rider: only the
	// rider a planning token acts for gets past them.
	log := slog.New(slog.DiscardHandler)
	mux := http.NewServeMux()
	nobody := tokens.ActingSource(&testx.Users{})
	customworkouts.New(st, nobody, log).Register(mux)
	crews.New(st, nobody, log).Register(mux)
	New(st, &fakeTokens{user: &u}, mux, log).Register(mux)
	return mux, st, u
}

func rpc(t *testing.T, mux *http.ServeMux, auth, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/mcp", strings.NewReader(body))
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestAuthRequired(t *testing.T) {
	mux, _, _ := setup(t)
	code, _ := rpc(t, mux, "", `{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	if code != http.StatusUnauthorized {
		t.Fatalf("no token must be 401, got %d", code)
	}
}

func TestHandshakeAndTools(t *testing.T) {
	mux, _, _ := setup(t)

	code, body := rpc(t, mux, "Bearer wrt_ok", `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`)
	result, _ := body["result"].(map[string]any)
	if code != http.StatusOK || result["protocolVersion"] != protocolVersion {
		t.Fatalf("initialize: got %d %v", code, body)
	}

	// A notification is acknowledged, not answered.
	code, _ = rpc(t, mux, "Bearer wrt_ok", `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	if code != http.StatusAccepted {
		t.Fatalf("notification: got %d", code)
	}

	_, body = rpc(t, mux, "Bearer wrt_ok", `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	tools, _ := body["result"].(map[string]any)["tools"].([]any)
	if len(tools) != 2 {
		t.Fatalf("expected 2 tools, got %v", body)
	}

	_, body = rpc(t, mux, "Bearer wrt_ok", `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_progression"}}`)
	content, _ := body["result"].(map[string]any)["content"].([]any)
	if len(content) != 1 {
		t.Fatalf("tools/call: got %v", body)
	}
	text, _ := content[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, `"category"`) {
		t.Fatalf("progression payload missing category: %s", text)
	}

	_, body = rpc(t, mux, "Bearer wrt_ok", `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"nope"}}`)
	if body["error"] == nil {
		t.Fatalf("unknown tool must error, got %v", body)
	}
}

// post is one JSON-RPC round trip as the token's owner.
func post(t *testing.T, mux *http.ServeMux, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer wrt_ok")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func rpcErr(body map[string]any) (float64, string) {
	e, _ := body["error"].(map[string]any)
	code, _ := e["code"].(float64)
	msg, _ := e["message"].(string)
	return code, msg
}

// The transport's edges (#1758): an out-of-range limit is refused rather
// than silently 30, a batch is -32600, a parse error carries "id": null, and
// list_rides answers ids and a `more` flag.
func TestTransportEdges(t *testing.T) {
	mux, _, _ := setup(t)
	if _, body := post(t, mux, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_rides","arguments":{"limit":5000}}}`); true {
		if code, msg := rpcErr(body); code != -32602 || !strings.Contains(msg, "1-200") {
			t.Fatalf("limit 5000: %v", body["error"])
		}
	}
	if _, body := post(t, mux, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_rides","arguments":"banana"}}`); true {
		if code, _ := rpcErr(body); code != -32602 {
			t.Fatalf("string arguments: %v", body["error"])
		}
	}
	if _, body := post(t, mux, `[{"jsonrpc":"2.0","id":3,"method":"ping"}]`); true {
		code, _ := rpcErr(body)
		if code != -32600 {
			t.Fatalf("a batch: %v", body["error"])
		}
		if id, has := body["id"]; !has || id != nil {
			t.Fatalf("a refused batch must carry id null: %v", body)
		}
	}
	if _, body := post(t, mux, `{not json`); true {
		if code, _ := rpcErr(body); code != -32700 {
			t.Fatalf("garbage: %v", body["error"])
		}
	}
	_, body := post(t, mux, `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_rides","arguments":{"limit":1}}}`)
	result, _ := body["result"].(map[string]any)
	content, _ := result["content"].([]any)
	if len(content) != 1 {
		t.Fatalf("list_rides result: %v", body)
	}
	first, _ := content[0].(map[string]any)
	var payload struct {
		Rides []map[string]any `json:"rides"`
		More  bool             `json:"more"`
	}
	text, _ := first["text"].(string)
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		t.Fatalf("payload: %v", err)
	}
	if _, has := payload.More, true; !has {
		t.Fatal("no more flag")
	}
	for _, ride := range payload.Rides {
		if _, has := ride["id"]; !has {
			t.Fatalf("a ride without an id: %v", ride)
		}
	}
}

// A model paging the rider's history must be handed every ride (#2064).
// list_rides read `before` and declared it nowhere, and the cursor it told
// the caller to reconstruct was `date` — RFC 3339 to the second, where a
// start is microseconds. Rides two per second are the case that skipped.
func TestListRidesPagesEveryRide(t *testing.T) {
	mux, st, user := setup(t)
	const rides, limit = 7, 3
	from := time.Now().Add(-48 * time.Hour).Truncate(time.Second)
	for i := range rides {
		if _, err := st.Queries.CreateRide(t.Context(), db.CreateRideParams{
			UserID: user.ID, WorkoutName: fmt.Sprintf("Seed %d", i),
			StartedAt: pgtype.Timestamptz{Time: from.Add(time.Duration(i) * 500 * time.Millisecond), Valid: true},
			Seconds:   600, AvgWatts: 200, Kj: 120, Execution: 1, ExecutionScored: true,
			FtpWatts: 250, Samples: []byte(`[]`), Curve: []byte(`{}`), Xp: 10,
		}); err != nil {
			t.Fatalf("seed ride %d: %v", i, err)
		}
	}

	seen := map[string]bool{}
	args := fmt.Sprintf(`{"limit":%d}`, limit)
	for page := 0; page < 10; page++ {
		_, body := post(t, mux, fmt.Sprintf(
			`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_rides","arguments":%s}}`, args))
		result, _ := body["result"].(map[string]any)
		content, _ := result["content"].([]any)
		if len(content) != 1 {
			t.Fatalf("page %d: %v", page, body)
		}
		first, _ := content[0].(map[string]any)
		var payload struct {
			Rides []struct {
				ID string `json:"id"`
			} `json:"rides"`
			More         bool   `json:"more"`
			NextBefore   string `json:"nextBefore"`
			NextBeforeID string `json:"nextBeforeId"`
		}
		text, _ := first["text"].(string)
		if err := json.Unmarshal([]byte(text), &payload); err != nil {
			t.Fatalf("page %d payload: %v", page, err)
		}
		for _, ride := range payload.Rides {
			if seen[ride.ID] {
				t.Fatalf("ride %s came back twice", ride.ID)
			}
			seen[ride.ID] = true
		}
		if !payload.More {
			break
		}
		if payload.NextBefore == "" || payload.NextBeforeID == "" {
			t.Fatalf("page %d says there is more but hands back no cursor: %s", page, text)
		}
		args = fmt.Sprintf(`{"limit":%d,"before":%q,"beforeId":%q}`, limit, payload.NextBefore, payload.NextBeforeID)
	}
	if len(seen) != rides {
		t.Fatalf("paging read %d of %d rides — the cursor skipped %d", len(seen), rides, rides-len(seen))
	}
}

// Half a cursor is refused rather than read as a time with no tie-break.
func TestListRidesCursorIsAPair(t *testing.T) {
	mux, _, _ := setup(t)
	for name, args := range map[string]string{
		"time alone":      `{"before":"2026-09-10T10:00:00Z"}`,
		"id alone":        `{"beforeId":"00000000-0000-0000-0000-000000000001"}`,
		"unparsable time": `{"before":"yesterday","beforeId":"00000000-0000-0000-0000-000000000001"}`,
		"unparsable id":   `{"before":"2026-09-10T10:00:00Z","beforeId":"nope"}`,
	} {
		t.Run(name, func(t *testing.T) {
			_, body := post(t, mux, fmt.Sprintf(
				`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_rides","arguments":%s}}`, args))
			code, msg := rpcErr(body)
			if code != -32602 {
				t.Fatalf("%s: %v", args, body)
			}
			if msg == "" {
				t.Error("a refusal with no message is a bug (errors.md)")
			}
		})
	}
}

// A ride's road summary stays off every AI context (#3053, ADR-0063): the
// metres, the climbing and the road's hashes are location-derived, and
// list_rides reads the same rows the history page does. The ride reads as a
// route ride (#3054), and a road whose route is gone brings no numbers.
func TestListRidesCarriesNoRoadSummary(t *testing.T) {
	mux, st, user := setup(t)
	distance, climbed, from := int32(12_345), int32(678), int32(1000)
	mode, key := "free", "a-road-hash"
	if _, err := st.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: user.ID, WorkoutName: "Openers",
		StartedAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true},
		Seconds:   600, AvgWatts: 200, Kj: 120, Execution: 1, ExecutionScored: true,
		FtpWatts: 250, Samples: []byte(`[]`), Curve: []byte(`{}`), Xp: 10,
		DistanceM: &distance, ClimbedM: &climbed, FromM: &from, RideMode: &mode, RouteKey: &key, RoadH: &key,
	}); err != nil {
		t.Fatalf("seed ride: %v", err)
	}
	_, body := post(t, mux, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_rides","arguments":{}}}`)
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	for _, leak := range []float64{12345, 12.3, 678} {
		if slices.Contains(numbersIn(t, body), leak) {
			t.Errorf("list_rides carries %v: %s", leak, raw)
		}
	}
	for _, leak := range []string{"a-road-hash", "distance", "climb", "rideMode", "routeId", "road", "km", "gainM"} {
		if strings.Contains(strings.ToLower(string(raw)), strings.ToLower(leak)) {
			t.Errorf("list_rides carries %q: %s", leak, raw)
		}
	}
	if !strings.Contains(string(raw), "Route ride") {
		t.Fatalf("the seeded ride is not in the answer as a route ride, so nothing was checked: %s", raw)
	}
}

// A route ride reaches an AI context as its road's numbers alone (#3054,
// ADR-0063): the generated name's km and gain, never the route's name, its
// id, a coordinate, or the ride's own metres — whatever the workout was
// called.
func TestListRidesNamesNoPlace(t *testing.T) {
	mux, st, user := setup(t)
	route, err := st.Queries.CreateRoute(t.Context(), db.CreateRouteParams{
		OwnerID: user.ID, Src: "gpx", Name: testx.Corridor.Route, GenName: "Road · 52.9 km · 1,312 m",
		Road: []byte("x"), RoadHash: "a-road-hash", LengthM: 52_940, GainM: 1312, Climbs: []byte(`[]`), EleSource: "file",
	})
	if err != nil {
		t.Fatal(err)
	}
	distance, climbed := int32(20_417), int32(533)
	if _, err := st.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: user.ID, WorkoutName: testx.Corridor.Route + " via " + testx.Corridor.Climbs[0],
		StartedAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true},
		Seconds:   3600, AvgWatts: 200, Kj: 720, Execution: 1, ExecutionScored: true,
		FtpWatts: 250, Samples: []byte(`[]`), Curve: []byte(`{}`), Xp: 10,
		RouteID: route.ID, DistanceM: &distance, ClimbedM: &climbed,
	}); err != nil {
		t.Fatal(err)
	}
	_, body := post(t, mux, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_rides","arguments":{}}}`)
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	if leak := testx.Leak(string(raw)); leak != "" {
		t.Errorf("list_rides carries %q: %s", leak, raw)
	}
	if strings.Contains(string(raw), store.UUIDString(route.ID)) {
		t.Errorf("list_rides carries the route's id: %s", raw)
	}
	// The ride's own metres, looked for as numbers: as substrings of the
	// answer they also matched inside the ride's random id (#3570).
	for _, leak := range []float64{20417, 20.4, 533} {
		if slices.Contains(numbersIn(t, body), leak) {
			t.Errorf("list_rides carries %v: %s", leak, raw)
		}
	}
	for _, want := range []string{`\"workout\":\"Route ride\"`, `\"km\":52.9`, `\"gainM\":1312`} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("list_rides lacks %s: %s", want, raw)
		}
	}
}

// A road ride the save never placed — no metres, or its route deleted — has
// no distance to mark it, and reaches an AI context as a route ride all the
// same, whatever name it was kept under (#4154).
func TestListRidesNamesNoPlaceForAnUnplacedRoadRide(t *testing.T) {
	mux, st, user := setup(t)
	onRoad := true
	if _, err := st.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: user.ID, WorkoutName: testx.Corridor.Route + " via " + testx.Corridor.Climbs[0],
		StartedAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true},
		Seconds:   3600, AvgWatts: 200, Kj: 720, Execution: 1, ExecutionScored: true,
		FtpWatts: 250, Samples: []byte(`[]`), Curve: []byte(`{}`), Xp: 10, OnRoad: &onRoad,
	}); err != nil {
		t.Fatal(err)
	}
	_, body := post(t, mux, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_rides","arguments":{}}}`)
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	if leak := testx.Leak(string(raw)); leak != "" || !strings.Contains(string(raw), `\"workout\":\"Route ride\"`) {
		t.Errorf("list_rides carries %q, or no route ride: %s", leak, raw)
	}
}

// The session flag rides under its standing name (#2959), beside the retired
// `room` a coach's script still reads until #3461 drops it: both present,
// both saying the same thing.
func TestListRidesCarriesInSessionNotRoom(t *testing.T) {
	mux, st, user := setup(t)
	if _, err := st.Queries.CreateRide(t.Context(), db.CreateRideParams{
		UserID: user.ID, WorkoutName: "Openers",
		StartedAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true},
		Seconds:   600, AvgWatts: 200, Kj: 120, Execution: 1, ExecutionScored: true,
		FtpWatts: 250, Samples: []byte(`[]`), Curve: []byte(`{}`), Xp: 10,
	}); err != nil {
		t.Fatalf("seed ride: %v", err)
	}
	_, body := post(t, mux, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_rides","arguments":{}}}`)
	result, _ := body["result"].(map[string]any)
	content, _ := result["content"].([]any)
	if len(content) != 1 {
		t.Fatalf("list_rides result: %v", body)
	}
	first, _ := content[0].(map[string]any)
	text, _ := first["text"].(string)
	var payload struct {
		Rides []map[string]any `json:"rides"`
	}
	if err := json.Unmarshal([]byte(text), &payload); err != nil || len(payload.Rides) != 1 {
		t.Fatalf("payload %v: %s", err, text)
	}
	ride := payload.Rides[0]
	in, has := ride["inSession"]
	if _, room := ride["room"]; !has || in != false || room {
		t.Fatalf("a solo ride: inSession %v (present %v), room present %v", in, has, room)
	}
}

// numbersIn is every number in a tool call's answer, its text payload decoded
// too: a value is looked for there, never as a substring of the raw answer,
// where it also matches inside a random id (#3570).
func numbersIn(t *testing.T, body map[string]any) []float64 {
	t.Helper()
	result, _ := body["result"].(map[string]any)
	content, _ := result["content"].([]any)
	var out []float64
	for _, c := range content {
		part, _ := c.(map[string]any)
		text, _ := part["text"].(string)
		var payload any
		if err := json.Unmarshal([]byte(text), &payload); err != nil {
			t.Fatalf("a tool's text is not JSON: %v", err)
		}
		out = append(out, walkNumbers(payload)...)
	}
	if out == nil {
		t.Fatalf("the answer holds no number at all, so nothing was checked: %v", body)
	}
	return out
}

func walkNumbers(v any) []float64 {
	switch v := v.(type) {
	case float64:
		return []float64{v}
	case []any:
		var out []float64
		for _, e := range v {
			out = append(out, walkNumbers(e)...)
		}
		return out
	case map[string]any:
		var out []float64
		for _, e := range v {
			out = append(out, walkNumbers(e)...)
		}
		return out
	}
	return nil
}

// planCall is one tools/call with a token, answering the tool's payload or
// the JSON-RPC error.
func planCall(t *testing.T, mux *http.ServeMux, token, tool, args string) (map[string]any, map[string]any) {
	t.Helper()
	_, body := rpc(t, mux, "Bearer "+token, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+tool+`","arguments":`+args+`}}`)
	if e, ok := body["error"].(map[string]any); ok {
		return nil, e
	}
	content, _ := body["result"].(map[string]any)["content"].([]any)
	if len(content) != 1 {
		t.Fatalf("%s: %v", tool, body)
	}
	var payload map[string]any
	text, _ := content[0].(map[string]any)["text"].(string)
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		t.Fatalf("%s payload: %v", tool, err)
	}
	return payload, nil
}

const sweetSpot = `{"name":"2x20 Sweet Spot","steps":[{"type":"warmup","seconds":600,"from":0.4,"to":0.7},` +
	`{"type":"repeat","times":2,"steps":[{"type":"steady","seconds":1200,"target":0.9},{"type":"steady","seconds":300,"target":0.5}]}]}`

// A token minted before #4207, or without the tick, reads and nothing more:
// the planning tools are neither listed nor callable, and nothing is saved.
func TestAReadTokenCannotPlan(t *testing.T) {
	mux, st, user := setup(t)
	_, body := rpc(t, mux, "Bearer wrt_ok", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	if tools, _ := body["result"].(map[string]any)["tools"].([]any); len(tools) != 2 {
		t.Fatalf("a read token lists %d tools, want the 2 reads: %v", len(tools), body)
	}
	crew := testx.Crew(t, st, "Tuesday crew", user.ID)
	for tool, args := range map[string]string{
		"create_workout":   `{"workout":` + sweetSpot + `}`,
		"schedule_workout": `{"crewId":"` + store.UUIDString(crew) + `","workout":` + sweetSpot + `,"startsAt":"` + time.Now().Add(24*time.Hour).Format(time.RFC3339) + `"}`,
		"get_schedule":     `{}`,
	} {
		if _, e := planCall(t, mux, "wrt_ok", tool, args); e == nil || !strings.Contains(fmt.Sprint(e["message"]), "only reads") {
			t.Errorf("%s with a read token: %v, want a refusal saying it only reads", tool, e)
		}
	}
	if n, err := st.Queries.CountUserWorkouts(t.Context(), user.ID); err != nil || n != 0 {
		t.Errorf("a read token saved %d workouts (%v)", n, err)
	}
	if n, err := st.Queries.CountCrewUpcoming(t.Context(), crew); err != nil || n != 0 {
		t.Errorf("a read token planned %d sessions (%v)", n, err)
	}
}

// A planning token saves a workout to the rider's shelf and plans it in
// their crew through the app's own handlers (#4207), and reads it back.
func TestAPlanningTokenCreatesSchedulesAndReadsBack(t *testing.T) {
	mux, st, user := setup(t)
	_, body := rpc(t, mux, "Bearer wrt_plan", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	if tools, _ := body["result"].(map[string]any)["tools"].([]any); len(tools) != 5 {
		t.Fatalf("a planning token lists %d tools, want 5: %v", len(tools), body)
	}

	saved, e := planCall(t, mux, "wrt_plan", "create_workout", `{"workout":`+sweetSpot+`}`)
	if e != nil || saved["name"] != "2x20 Sweet Spot" || saved["id"] == "" {
		t.Fatalf("create_workout: %v %v", saved, e)
	}
	shelf, err := st.Queries.ListUserWorkouts(t.Context(), db.ListUserWorkoutsParams{OwnerID: user.ID, Limit: 10})
	if err != nil || len(shelf) != 1 || store.UUIDString(shelf[0].ID) != saved["id"] || shelf[0].Author != "alice" {
		t.Fatalf("the shelf holds %v (%v), want the one workout, authored by its rider", shelf, err)
	}

	crew := testx.Crew(t, st, "Tuesday crew", user.ID)
	at := time.Now().Add(48 * time.Hour).Truncate(time.Second)
	plan, e := planCall(t, mux, "wrt_plan", "schedule_workout",
		`{"crewId":"`+store.UUIDString(crew)+`","workout":`+sweetSpot+`,"startsAt":"`+at.Format(time.RFC3339)+`"}`)
	if e != nil || plan["id"] == "" || plan["workout"] != "2x20 Sweet Spot" {
		t.Fatalf("schedule_workout: %v %v", plan, e)
	}

	got, e := planCall(t, mux, "wrt_plan", "get_schedule", `{}`)
	if e != nil {
		t.Fatalf("get_schedule: %v", e)
	}
	crewsOut, _ := got["crews"].([]any)
	sessions, _ := got["sessions"].([]any)
	if len(crewsOut) != 1 || !strings.Contains(fmt.Sprint(crewsOut[0]), store.UUIDString(crew)) {
		t.Errorf("get_schedule crews: %v", crewsOut)
	}
	if len(sessions) != 1 {
		t.Fatalf("get_schedule sessions: %v", sessions)
	}
	first, _ := sessions[0].(map[string]any)
	startsAt, _ := time.Parse(time.RFC3339, fmt.Sprint(first["startsAt"]))
	if first["id"] != plan["id"] || first["workout"] != "2x20 Sweet Spot" || !startsAt.Equal(at) {
		t.Errorf("get_schedule session: %v, want plan %v at %s", first, plan["id"], at.Format(time.RFC3339))
	}
}

// Every refusal is the app's own, said to the model: the handlers' checks
// run, and a crew the rider is not in is no crew at all.
func TestPlanningRefusals(t *testing.T) {
	mux, st, user := setup(t)
	stranger, err := st.Queries.CreateUser(t.Context(), db.CreateUserParams{DisplayName: "bob", FtpWatts: 200, WeightKg: 70})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = st.Pool.Exec(context.Background(), "delete from users where id = $1", stranger.ID) })
	theirs := store.UUIDString(testx.Crew(t, st, "Not hers", stranger.ID))
	mine := store.UUIDString(testx.Crew(t, st, "Hers", user.ID))
	tomorrow := time.Now().Add(24 * time.Hour).Format(time.RFC3339)
	road := `{"name":"Home loop","road":{"routeId":"` + store.UUIDString(user.ID) + `","fromM":0,"toM":3000},"steps":[{"type":"road","seconds":600}]}`

	for _, tc := range []struct{ name, tool, args, want string }{
		{"not a workout", "create_workout", `{"workout":{"name":"x","steps":[]}}`, "engine can ride"},
		{"no name", "create_workout", `{"workout":{"steps":[{"type":"steady","seconds":60,"target":0.5}]}}`, "name"},
		{"a road", "create_workout", `{"workout":` + road + `}`, "no road"},
		{"no workout", "create_workout", `{}`, "workout is required"},
		{"an unknown argument", "create_workout", `{"workout":` + sweetSpot + `,"author":"x"}`, "arguments must be"},
		{"someone else's crew", "schedule_workout", `{"crewId":"` + theirs + `","workout":` + sweetSpot + `,"startsAt":"` + tomorrow + `"}`, "No crew"},
		{"a path for a crew", "schedule_workout", `{"crewId":"../../workouts","workout":` + sweetSpot + `,"startsAt":"` + tomorrow + `"}`, "crewId"},
		{"a time with no offset", "schedule_workout", `{"crewId":"` + mine + `","workout":` + sweetSpot + `,"startsAt":"2026-12-01 18:00"}`, "RFC 3339"},
		{"a year out", "schedule_workout", `{"crewId":"` + mine + `","workout":` + sweetSpot + `,"startsAt":"` + time.Now().AddDate(1, 0, 0).Format(time.RFC3339) + `"}`, "three months"},
		{"a road plan", "schedule_workout", `{"crewId":"` + mine + `","workout":` + road + `,"startsAt":"` + tomorrow + `"}`, "no road"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, e := planCall(t, mux, "wrt_plan", tc.tool, tc.args)
			if e == nil || e["code"] != float64(-32602) || !strings.Contains(fmt.Sprint(e["message"]), tc.want) {
				t.Errorf("%s: %v, want -32602 saying %q", tc.name, e, tc.want)
			}
		})
	}
	if n, err := st.Queries.CountUserWorkouts(t.Context(), user.ID); err != nil || n != 0 {
		t.Errorf("a refused create saved %d workouts (%v)", n, err)
	}
}

// A crewmate's plan on a road reaches the AI as `Route ride` with the
// route's km and gain (ADR-0063): never its name, its id or its shape.
func TestGetScheduleNamesNoPlace(t *testing.T) {
	mux, st, user := setup(t)
	route, err := st.Queries.CreateRoute(t.Context(), db.CreateRouteParams{
		OwnerID: user.ID, Src: "gpx", Name: testx.Corridor.Route, GenName: "Road · 52.9 km · 1,312 m",
		Road: []byte("x"), RoadHash: "a-road-hash", LengthM: 52_940, GainM: 1312, Climbs: []byte(`[]`), EleSource: "file",
	})
	if err != nil {
		t.Fatal(err)
	}
	crew := testx.Crew(t, st, "Tuesday crew", user.ID)
	def := `{"name":"` + testx.Corridor.Route + `","road":{"routeId":"` + store.UUIDString(route.ID) + `","fromM":0,"toM":3000},"steps":[{"type":"road","seconds":600}]}`
	if _, err := st.Queries.CreateCrewPlan(t.Context(), db.CreateCrewPlanParams{
		CrewID: crew, WorkoutName: testx.Corridor.Route + " via " + testx.Corridor.Climbs[0], WorkoutJson: []byte(def),
		StartsAt: pgtype.Timestamptz{Time: time.Now().Add(24 * time.Hour), Valid: true}, CreatedBy: user.ID, RouteID: route.ID,
	}); err != nil {
		t.Fatal(err)
	}
	got, e := planCall(t, mux, "wrt_plan", "get_schedule", `{}`)
	if e != nil {
		t.Fatalf("get_schedule: %v", e)
	}
	raw, _ := json.Marshal(got)
	if leak := testx.Leak(string(raw)); leak != "" {
		t.Errorf("get_schedule carries %q: %s", leak, raw)
	}
	if strings.Contains(string(raw), store.UUIDString(route.ID)) {
		t.Errorf("get_schedule carries the route's id: %s", raw)
	}
	for _, want := range []string{`"workout":"Route ride"`, `"km":52.9`, `"gainM":1312`} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("get_schedule lacks %s: %s", want, raw)
		}
	}
}
