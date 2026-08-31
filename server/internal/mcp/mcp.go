// Package mcp is ADR-0017's coach endpoint: a minimal streamable-HTTP MCP
// server (JSON-RPC over single POST round-trips) exposing read-only tools
// that mirror the HTTP API. Bearer-token auth only; no sessions, no SSE.
// ponytail: hand-rolled at ~200 lines — swap for the official Go SDK if the
// protocol surface ever grows past tools.
package mcp

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/natrontech/wattroom/server/internal/progression"
	"github.com/natrontech/wattroom/server/internal/store"
	"github.com/natrontech/wattroom/server/internal/store/db"
)

const protocolVersion = "2025-06-18"

type TokenSource interface {
	FromRequest(r *http.Request) (db.User, bool)
}

type Service struct {
	store  *store.Store
	tokens TokenSource
	log    *slog.Logger
}

func New(st *store.Store, tokens TokenSource, log *slog.Logger) *Service {
	return &Service{store: st, tokens: tokens, log: log}
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
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, `{"error":"unauthorized","message":"A personal token from your profile goes in the Authorization header."}`,
			http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	var req rpcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.reply(w, nil, nil, &rpcError{Code: -32700, Message: "parse error"})
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
		s.call(w, r.Context(), req, user)
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
		"name":        "list_rides",
		"description": "The rider's recent ride summaries, newest first: workout, date, duration, average watts, kJ, execution score.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"limit": map[string]any{
					"type":        "integer",
					"description": "How many rides (1-200, default 30).",
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

func (s *Service) listRides(ctx context.Context, user db.User, args json.RawMessage) (any, error) {
	limit := int32(30)
	if len(args) > 0 {
		var in struct {
			Limit int32 `json:"limit"`
		}
		if err := json.Unmarshal(args, &in); err == nil && in.Limit >= 1 && in.Limit <= 200 {
			limit = in.Limit
		}
	}
	rows, err := s.store.Queries.ListUserRides(ctx, db.ListUserRidesParams{
		UserID: user.ID, Limit: limit,
	})
	if err != nil {
		return nil, err
	}
	type ride struct {
		Workout   string  `json:"workout"`
		Date      string  `json:"date"`
		Seconds   int     `json:"seconds"`
		AvgWatts  int     `json:"avgWatts"`
		Kj        int     `json:"kj"`
		Execution float64 `json:"execution"`
		Room      bool    `json:"room"`
	}
	out := make([]ride, 0, len(rows))
	for _, row := range rows {
		out = append(out, ride{
			Workout: row.WorkoutName, Date: row.StartedAt.Time.Format(time.RFC3339),
			Seconds: int(row.Seconds), AvgWatts: int(row.AvgWatts), Kj: int(row.Kj),
			Execution: float64(row.Execution), Room: row.RoomID.Valid,
		})
	}
	return map[string]any{"rides": out}, nil
}

func (s *Service) reply(w http.ResponseWriter, id json.RawMessage, result any, rpcErr *rpcError) {
	body := map[string]any{"jsonrpc": "2.0"}
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
