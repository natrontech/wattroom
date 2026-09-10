// Package mcp is ADR-0017's coach endpoint: a minimal streamable-HTTP MCP
// server (JSON-RPC over single POST round-trips) exposing read-only tools
// that mirror the HTTP API. Bearer-token auth only; no sessions, no SSE.
// ponytail: hand-rolled at ~200 lines — swap for the official Go SDK if the
// protocol surface ever grows past tools.
package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/natrontech/wattroom/server/internal/budget"
	"github.com/natrontech/wattroom/server/internal/httpx"
	"log/slog"
	"net/http"
	"time"

	"github.com/natrontech/wattroom/server/internal/keyset"
	"github.com/natrontech/wattroom/server/internal/progression"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

const protocolVersion = "2025-06-18"

type TokenSource interface {
	FromRequest(r *http.Request) (db.User, bool)
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
	log       *slog.Logger
}

func New(st *store.Store, tokens TokenSource, log *slog.Logger) *Service {
	return &Service{store: st, tokens: tokens, log: log,
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
		s.reply(w, req.ID, map[string]any{"tools": toolList}, nil)
	case "tools/call":
		// A tool runs for as long as the database takes otherwise (#1758).
		ctx, cancel := context.WithTimeout(r.Context(), callTimeout)
		defer cancel()
		s.call(w, ctx, req, user)
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
			"average watts, kJ, execution score. Answers `more` when older rides remain, with " +
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

func (s *Service) call(w http.ResponseWriter, ctx context.Context, req rpcRequest, user db.User) {
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
		ID                string  `json:"id"`
		Workout           string  `json:"workout"`
		Date              string  `json:"date"`
		Seconds           int     `json:"seconds"`
		AvgWatts          int     `json:"avgWatts"`
		Kj                int     `json:"kj"`
		Execution         float64 `json:"execution"`
		ExecutionScored   bool    `json:"executionScored"`
		Ftp               int     `json:"ftp"`
		Xp                int     `json:"xp"`
		Room              bool    `json:"room"`
		SharedWithFriends bool    `json:"sharedWithFriends"`
	}
	out := make([]ride, 0, len(rows))
	for _, row := range rows {
		out = append(out, ride{
			ID: store.UUIDString(row.ID), Workout: row.WorkoutName, Date: row.StartedAt.Time.Format(time.RFC3339),
			Seconds: int(row.Seconds), AvgWatts: int(row.AvgWatts), Kj: int(row.Kj),
			Execution: float64(row.Execution), ExecutionScored: row.ExecutionScored, Ftp: int(row.FtpWatts), Xp: int(row.Xp),
			Room: row.RoomID.Valid, SharedWithFriends: row.SharedAt.Valid,
		})
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
