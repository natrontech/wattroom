// Package mcp is ADR-0017's coach endpoint: a minimal streamable-HTTP MCP
// server (JSON-RPC over single POST round-trips) exposing tools that mirror
// the HTTP API. Bearer-token auth only; no sessions, no SSE. Every token
// reads; a token the rider marked for planning (#4207) also gets the tools
// that save a workout and plan a session, which run the app's own handlers.
// ponytail: hand-rolled at ~200 lines — swap for the official Go SDK if the
// protocol surface ever grows past tools.
package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/natrontech/wattroom/server/internal/budget"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"log/slog"
	"math"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/natrontech/wattroom/server/internal/crews"
	"github.com/natrontech/wattroom/server/internal/keyset"
	"github.com/natrontech/wattroom/server/internal/progression"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
	"github.com/natrontech/wattroom/server/internal/tokens"
	"github.com/natrontech/wattroom/server/internal/workout"
)

const protocolVersion = "2025-06-18"

type TokenSource interface {
	FromRequest(r *http.Request) (db.User, bool)
	// Whether the rider marked the token for planning (#4207).
	CanWrite(r *http.Request) bool
}

const (
	// Per account a minute (#1758): a tool call touches the token's row and
	// may scan a year of rides. The sign-in ceiling for the 401 path.
	callsPerWindow     = 60
	strangersPerWindow = 30
	callTimeout        = 10 * time.Second
)

type Service struct {
	calls     *budget.Budget[string]
	strangers *budget.Budget[string]
	store     *store.Store
	tokens    TokenSource
	// The app's own mux: a planning tool serves the request a rider's click
	// would send, so every check, ceiling and mail is the app's (#4207).
	api http.Handler
	log *slog.Logger
}

func New(st *store.Store, tokens TokenSource, api http.Handler, log *slog.Logger) *Service {
	return &Service{store: st, tokens: tokens, api: api, log: log,
		calls: budget.New[string](callsPerWindow, time.Minute), strangers: budget.New[string](strangersPerWindow, time.Minute)}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /mcp", s.handle)
}

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (s *Service) handle(w http.ResponseWriter, r *http.Request) {
	user, ok := s.tokens.FromRequest(r)
	if !ok {
		// A guess at a token spends the address's window (#1758).
		if s.strangers != nil && !s.strangers.Spend(httpx.ClientIP(r)) {
			httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited", "Too many tries from this address — give it a minute.")
			return
		}
		w.Header().Set("WWW-Authenticate", "Bearer")
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "A personal token from your settings goes in the Authorization header.")
		return
	}
	// Every call touches the token's row and may scan a year of rides: a
	// read token was a write amplifier with no ceiling (#1758).
	if s.calls != nil && !s.calls.Spend(store.UUIDString(user.ID)) {
		httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited", "Too many calls in one minute — give it a moment.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	var req rpcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var tooBig *http.MaxBytesError
		switch {
		case errors.As(err, &tooBig):
			s.reply(w, nil, nil, &rpcError{Code: -32600, Message: "request too large"})
		case isBatch(err):
			// Batching left the protocol in 2025-06-18; refusing is right, and
			// -32600 says what was wrong with the request.
			s.reply(w, nil, nil, &rpcError{Code: -32600, Message: "batch requests are not supported"})
		default:
			s.reply(w, nil, nil, &rpcError{Code: -32700, Message: "parse error"})
		}
		return
	}
	// Notifications (no id) are acknowledged and dropped — nothing stateful
	// lives here to receive them.
	if len(req.ID) == 0 || string(req.ID) == "null" {
		w.WriteHeader(http.StatusAccepted)
		return
	}

	switch req.Method {
	case "initialize":
		s.reply(w, req.ID, map[string]any{
			"protocolVersion": protocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "wattroom", "version": "1"},
		}, nil)
	case "ping":
		s.reply(w, req.ID, map[string]any{}, nil)
	case "tools/list":
		// A read token is not shown tools it may not call (#4207).
		tools := toolList
		if s.tokens.CanWrite(r) {
			tools = append(slices.Clip(toolList), planTools...)
		}
		s.reply(w, req.ID, map[string]any{"tools": tools}, nil)
	case "tools/call":
		// A tool runs for as long as the database takes otherwise (#1758).
		ctx, cancel := context.WithTimeout(r.Context(), callTimeout)
		defer cancel()
		s.call(w, ctx, r, req, user)
	default:
		s.reply(w, req.ID, nil, &rpcError{Code: -32601, Message: "method not found"})
	}
}

var toolList = []map[string]any{
	{
		"name": "get_progression",
		"description": "The rider's training analysis, from their WattRoom rides only: power-curve " +
			"bests (30/90 days/all-time), per-ride FTP and 20-min-best trend, Category and w/kg, " +
			"training load (fitness/fatigue/form with zone) and today's workout suggestion. " +
			"Same payload the WattRoom UI shows.",
		"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
	},
	{
		"name": "list_rides",
		"description": "The rider's recent ride summaries, newest first: workout, date, duration, " +
			"average watts, kJ, execution score, `Route ride` as the workout of a ride on a road with " +
			"that road's `km` and `gainM`, and `inSession` for a ride ridden in a crew " +
			"session. " +
			"Answers `more` when older rides remain, with " +
			"`nextBefore`/`nextBeforeId` to pass back for the next page.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"limit": map[string]any{
					"type":        "integer",
					"description": "How many rides (1-200, default 30).",
				},
				// Declared, because a hidden parameter is one no model can
				// use: `before` was read here and named nowhere (#2064), so
				// nothing ever paged past the first answer.
				"before": map[string]any{
					"type":        "string",
					"description": "Page from a previous answer's nextBefore. Send with beforeId.",
				},
				"beforeId": map[string]any{
					"type":        "string",
					"description": "Page from a previous answer's nextBeforeId. Send with before.",
				},
			},
		},
	},
}

// workoutSchema is the workout every planning tool takes: docs/spec/workouts.md's
// JSON, which the editor and the ride both read.
var workoutSchema = map[string]any{
	"type": "object",
	"description": "A WattRoom workout: {\"name\": \"2x20 Sweet Spot\", \"steps\": [...]}. " +
		"Step types: warmup/cooldown/ramp {seconds, from, to}, steady {seconds, target}, " +
		"repeat {times, steps}, sprint {seconds} (an all-out 15 s marker). Targets are fractions " +
		"of FTP (0.9 = 90 %), or `watts` instead of `target`; a steady step may add " +
		"cadenceLow/cadenceHigh (rpm) or hrLow/hrHigh (bpm). No road: the rider picks roads in WattRoom.",
}

// planTools are the writes (#4207), listed and callable only for a token the
// rider marked for planning. Each answers ids and the numbers it was given,
// never a road: a workout carrying one is refused before it is saved.
var planTools = []map[string]any{
	{
		"name": "create_workout",
		"description": "Saves a workout to the rider's own shelf in WattRoom, where they can ride it " +
			"solo or pick it for a crew session. Answers its `id` and `name`. The shelf holds 200.",
		"inputSchema": map[string]any{
			"type":       "object",
			"properties": map[string]any{"workout": workoutSchema},
			"required":   []string{"workout"},
		},
	},
	{
		"name": "schedule_workout",
		"description": "Plans a workout as a session on one of the rider's crews' calendars, in the " +
			"rider's name, between now and three months out. The crew is mailed and sees it on its " +
			"schedule, as when the rider plans it themselves. Answers the plan's `id`. " +
			"get_schedule names the crews.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"crewId":  map[string]any{"type": "string", "description": "A crew id from get_schedule."},
				"workout": workoutSchema,
				"startsAt": map[string]any{
					"type":        "string",
					"description": "When it starts: RFC 3339 with an offset, e.g. 2026-11-10T18:30:00+01:00.",
				},
				"channelId": map[string]any{
					"type":        "string",
					"description": "A voice channel of the crew to ride it in. Leave out to name none yet.",
				},
			},
			"required": []string{"crewId", "workout", "startsAt"},
		},
	},
	{
		"name": "get_schedule",
		"description": "The rider's crews (`id`, `name`) and every session planned in them from now " +
			"on, soonest first: workout, `startsAt`, crew, voice channel and how many said they are in. " +
			"A session on a road reads `Route ride` with that road's `km` and `gainM`.",
		"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
	},
}

func (s *Service) call(w http.ResponseWriter, ctx context.Context, r *http.Request, req rpcRequest, user db.User) {
	var params struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		s.reply(w, req.ID, nil, &rpcError{Code: -32602, Message: "invalid params"})
		return
	}
	var payload any
	var err error
	switch params.Name {
	case "get_progression":
		payload, err = progression.Summary(ctx, s.store.Queries, user)
	case "list_rides":
		payload, err = s.listRides(ctx, user, params.Arguments)
	case "create_workout", "schedule_workout", "get_schedule":
		if !s.tokens.CanWrite(r) {
			s.reply(w, req.ID, nil, &rpcError{Code: -32602, Message: "this token only reads: " +
				"the rider creates one with Let it plan workouts ticked under Settings, Data, Coach access"})
			return
		}
		switch params.Name {
		case "create_workout":
			payload, err = s.createWorkout(ctx, user, params.Arguments)
		case "schedule_workout":
			payload, err = s.scheduleWorkout(ctx, user, params.Arguments)
		default:
			payload, err = s.schedule(ctx, user)
		}
	default:
		s.reply(w, req.ID, nil, &rpcError{Code: -32602, Message: "unknown tool"})
		return
	}
	var invalid errInvalidParams
	if errors.As(err, &invalid) {
		s.reply(w, req.ID, nil, &rpcError{Code: -32602, Message: string(invalid)})
		return
	}
	if err != nil {
		s.log.Error("mcp tool failed", "tool", params.Name, "err", err)
		s.reply(w, req.ID, nil, &rpcError{Code: -32603, Message: "internal error"})
		return
	}
	text, err := json.Marshal(payload)
	if err != nil {
		s.reply(w, req.ID, nil, &rpcError{Code: -32603, Message: "internal error"})
		return
	}
	s.reply(w, req.ID, map[string]any{
		"content": []map[string]any{{"type": "text", "text": string(text)}},
	}, nil)
}

// errInvalidParams is a refusal the caller can act on; call answers it as
// -32602 with the sentence, never as an internal error.
type errInvalidParams string

func (e errInvalidParams) Error() string { return string(e) }

func (s *Service) listRides(ctx context.Context, user db.User, args json.RawMessage) (any, error) {
	params := db.ListUserRidesParams{UserID: user.ID, Limit: 30}
	if len(args) > 0 && string(args) != "null" {
		var in struct {
			Limit    *int32 `json:"limit"`
			Before   string `json:"before"`
			BeforeID string `json:"beforeId"`
		}
		dec := json.NewDecoder(bytes.NewReader(args))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&in); err != nil {
			return nil, errInvalidParams("arguments must be an object with limit (1-200) and the before/beforeId pair from a previous answer")
		}
		// Out of range used to fall silently back to 30 (#1758): a model that
		// asked for 200 and got 30 concluded the rider has 30 rides.
		if in.Limit != nil {
			if *in.Limit < 1 || *in.Limit > 200 {
				return nil, errInvalidParams("limit must be 1-200")
			}
			params.Limit = *in.Limit
		}
		// One cursor, two halves (#2064). `before` alone reads as a time with
		// no tie-break, which is how the page boundary silently stepped over
		// every ride inside one second. Same parser the HTTP list uses; the
		// sentence comes back unpunctuated, which is this transport's voice.
		cursor, err := keyset.Parse(in.Before, in.BeforeID, "ride")
		if err != nil {
			return nil, errInvalidParams(err.Error())
		}
		cursor.Apply(&params.Before, &params.BeforeID)
	}
	rows, err := s.store.Queries.ListUserRides(ctx, params)
	if err != nil {
		return nil, err
	}
	// The HTTP list's fields (ADR-0017: the tools mirror it), the id included
	// so a follow-up can name a ride, and `more` with the cursor for the
	// next page.
	type ride struct {
		ID                string   `json:"id"`
		Workout           string   `json:"workout"`
		Date              string   `json:"date"`
		Seconds           int      `json:"seconds"`
		AvgWatts          int      `json:"avgWatts"`
		Kj                int      `json:"kj"`
		Execution         float64  `json:"execution"`
		ExecutionScored   bool     `json:"executionScored"`
		Ftp               int      `json:"ftp"`
		Xp                int      `json:"xp"`
		InSession         bool     `json:"inSession"`
		SharedWithFriends bool     `json:"sharedWithFriends"`
		Km                *float64 `json:"km,omitempty"`
		GainM             *int32   `json:"gainM,omitempty"`
	}
	numbers, err := s.routeNumbers(ctx, rows)
	if err != nil {
		return nil, err
	}
	out := make([]ride, 0, len(rows))
	for _, row := range rows {
		r := ride{
			ID: store.UUIDString(row.ID), Workout: row.WorkoutName, Date: row.StartedAt.Time.Format(time.RFC3339),
			Seconds: int(row.Seconds), AvgWatts: int(row.AvgWatts), Kj: int(row.Kj),
			Execution: float64(row.Execution), ExecutionScored: row.ExecutionScored, Ftp: int(row.FtpWatts), Xp: int(row.Xp),
			InSession: row.InSession, SharedWithFriends: row.SharedAt.Valid,
		}
		// A road ride is its road's numbers and nothing else here (#3054,
		// ADR-0063): its workout is named after the route, and a route's name
		// is a place, which never enters an AI context — nor does its id, its
		// shape or the ride's own metres (#3053). One the save never placed
		// is marked on_road alone (#4154).
		if row.DistanceM != nil || row.OnRoad != nil && *row.OnRoad {
			r.Workout = "Route ride"
			if n, ok := numbers[store.UUIDString(row.ID)]; ok {
				km := math.Round(float64(n.LengthM)/100) / 10
				r.Km, r.GainM = &km, &n.GainM
			}
		}
		out = append(out, r)
	}
	payload := map[string]any{"rides": out, "more": len(rows) == int(params.Limit)}
	// The cursor comes from here rather than from the caller re-reading
	// `date`: that field is RFC 3339 to the second where started_at is
	// microseconds, and a cursor rounded down by a fraction of a second
	// steps over every ride inside it (#2064).
	if len(rows) == int(params.Limit) {
		last := rows[len(rows)-1]
		keyset.Next(payload, last.StartedAt, last.ID)
	}
	return payload, nil
}

// planArgs decodes a planning tool's arguments strictly and returns the
// workout's name. A workout that rides a road is refused: an AI never holds a
// route (ADR-0063), and a road workout's answer would carry its road and the
// route's name.
func planArgs(args json.RawMessage, into any, raw *json.RawMessage, usage string) (string, error) {
	dec := json.NewDecoder(bytes.NewReader(args))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		return "", errInvalidParams("arguments must be an object with " + usage)
	}
	if len(*raw) == 0 || string(*raw) == "null" {
		return "", errInvalidParams("workout is required")
	}
	if workout.OnRoad(string(*raw)) {
		return "", errInvalidParams("a workout here rides no road: the rider picks a road in WattRoom")
	}
	var named struct {
		Name string `json:"name"`
	}
	_ = json.Unmarshal(*raw, &named)
	return strings.TrimSpace(named.Name), nil
}

func (s *Service) createWorkout(ctx context.Context, user db.User, args json.RawMessage) (any, error) {
	var in struct {
		Workout json.RawMessage `json:"workout"`
	}
	name, err := planArgs(args, &in, &in.Workout, "workout")
	if err != nil {
		return nil, err
	}
	out, err := s.viaAPI(ctx, user, "/api/workouts", map[string]any{"workout": in.Workout})
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": out["id"], "name": name}, nil
}

func (s *Service) scheduleWorkout(ctx context.Context, user db.User, args json.RawMessage) (any, error) {
	var in struct {
		CrewID    string          `json:"crewId"`
		Workout   json.RawMessage `json:"workout"`
		StartsAt  string          `json:"startsAt"`
		ChannelID string          `json:"channelId"`
	}
	name, err := planArgs(args, &in, &in.Workout, "crewId, workout, startsAt and an optional channelId")
	if err != nil {
		return nil, err
	}
	// The id goes into a path on the app's own mux: a uuid or nothing.
	crew, err := store.ParseUUID(in.CrewID)
	if err != nil {
		return nil, errInvalidParams("crewId must be a crew id from get_schedule")
	}
	if _, err := time.Parse(time.RFC3339, in.StartsAt); err != nil {
		return nil, errInvalidParams("startsAt must be an RFC 3339 time with an offset, e.g. 2026-11-10T18:30:00+01:00")
	}
	out, err := s.viaAPI(ctx, user, "/api/crews/"+store.UUIDString(crew)+"/schedule", map[string]any{
		"workoutName": name, "workoutJson": string(in.Workout),
		"startsAt": in.StartsAt, "channelId": in.ChannelID,
	})
	if err != nil {
		return nil, err
	}
	plan := map[string]any{"id": out["id"], "crewId": store.UUIDString(crew),
		"workout": out["workoutName"], "startsAt": out["startsAt"]}
	if channel, ok := out["channelId"]; ok {
		plan["channelId"] = channel
	}
	return plan, nil
}

// schedule is get_schedule: the crews a plan can go to, and Home's list of
// what is planned in them, without who planned it or who answered.
func (s *Service) schedule(ctx context.Context, user db.User) (any, error) {
	crewRows, err := s.store.Queries.ListCrewsFor(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	type crewJSON struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	crewsOut := make([]crewJSON, 0, len(crewRows))
	for _, c := range crewRows {
		crewsOut = append(crewsOut, crewJSON{ID: store.UUIDString(c.ID), Name: c.Name})
	}
	rows, err := crews.Upcoming(ctx, s.store.Queries, user.ID)
	if err != nil {
		return nil, err
	}
	var onRoad []pgtype.UUID
	for _, row := range rows {
		if workout.OnRoad(string(row.WorkoutJson)) {
			onRoad = append(onRoad, row.ID)
		}
	}
	numbers := map[pgtype.UUID]db.RouteNumbersOfPlansRow{}
	if len(onRoad) > 0 {
		found, err := s.store.Queries.RouteNumbersOfPlans(ctx, onRoad)
		if err != nil {
			return nil, err
		}
		for _, n := range found {
			numbers[n.ID] = n
		}
	}
	type session struct {
		ID          string   `json:"id"`
		CrewID      string   `json:"crewId"`
		CrewName    string   `json:"crewName"`
		Workout     string   `json:"workout"`
		StartsAt    string   `json:"startsAt"`
		ChannelID   string   `json:"channelId,omitempty"`
		ChannelName string   `json:"channelName,omitempty"`
		Going       int32    `json:"going"`
		Km          *float64 `json:"km,omitempty"`
		GainM       *int32   `json:"gainM,omitempty"`
	}
	sessions := make([]session, 0, len(rows))
	for _, row := range rows {
		out := session{
			ID: store.UUIDString(row.ID), CrewID: store.UUIDString(row.CrewID), CrewName: row.CrewName,
			Workout: row.WorkoutName, StartsAt: row.StartsAt.Time.Format(time.RFC3339), Going: row.GoingCount,
		}
		if row.ChannelID.Valid {
			out.ChannelID, out.ChannelName = store.UUIDString(row.ChannelID), row.ChannelName
		}
		// A plan on a road is named after its route, and a route's name is a
		// place: it reaches an AI as its numbers alone, as list_rides' rides do.
		if workout.OnRoad(string(row.WorkoutJson)) {
			out.Workout = "Route ride"
			if n, ok := numbers[row.ID]; ok {
				km := math.Round(float64(n.LengthM)/100) / 10
				out.Km, out.GainM = &km, &n.GainM
			}
		}
		sessions = append(sessions, out)
	}
	return map[string]any{"crews": crewsOut, "sessions": sessions}, nil
}

// viaAPI serves one POST on the app's own mux as the rider (#4207) and reads
// its answer: a refusal comes back as the sentence the app wrote for the
// rider, a failure as an error the caller logs.
func (s *Service) viaAPI(ctx context.Context, user db.User, path string, body any) (map[string]any, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(tokens.Acting(ctx, user), http.MethodPost, path, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	rec := &recorder{header: http.Header{}, code: http.StatusOK}
	s.api.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.body.Bytes(), &out)
	switch {
	case rec.code >= 500:
		return nil, fmt.Errorf("mcp: POST %s answered %d", path, rec.code)
	case rec.code >= 400:
		message, _ := out["message"].(string)
		if message == "" {
			message = "WattRoom refused that"
		}
		return nil, errInvalidParams(message)
	}
	return out, nil
}

// recorder is the ResponseWriter viaAPI hands the mux.
type recorder struct {
	header http.Header
	code   int
	body   bytes.Buffer
}

func (r *recorder) Header() http.Header         { return r.header }
func (r *recorder) Write(b []byte) (int, error) { return r.body.Write(b) }
func (r *recorder) WriteHeader(code int)        { r.code = code }

// routeNumbers is the route's length and gain for each road ride on the page,
// by ride id. Only a road ride has a distance (stats.SetRoad).
func (s *Service) routeNumbers(ctx context.Context, rows []db.ListUserRidesRow) (map[string]db.RouteNumbersOfRidesRow, error) {
	var ids []pgtype.UUID
	for _, row := range rows {
		if row.DistanceM != nil {
			ids = append(ids, row.ID)
		}
	}
	out := map[string]db.RouteNumbersOfRidesRow{}
	if len(ids) == 0 {
		return out, nil
	}
	found, err := s.store.Queries.RouteNumbersOfRides(ctx, ids)
	for _, n := range found {
		out[store.UUIDString(n.ID)] = n
	}
	return out, err
}

// isBatch says whether the body began a JSON array — a batch, which the
// protocol no longer has.
func isBatch(err error) bool {
	var ute *json.UnmarshalTypeError
	return errors.As(err, &ute) && ute.Value == "array"
}

func (s *Service) reply(w http.ResponseWriter, id json.RawMessage, result any, rpcErr *rpcError) {
	// "id": null when the request's id could not be read (JSON-RPC 2.0 §5).
	body := map[string]any{"jsonrpc": "2.0", "id": nil}
	if id != nil {
		body["id"] = id
	}
	if rpcErr != nil {
		body["error"] = rpcErr
	} else {
		body["result"] = result
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(body); err != nil {
		s.log.Warn("mcp write failed", "err", err)
	}
}
