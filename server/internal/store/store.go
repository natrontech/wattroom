// Package store owns the Postgres connection and the schema's lifecycle.
//
// Migrations are embedded and run at startup: the deploy is one binary on one
// VM (ADR-0002), so "migrate then start" is not a pipeline step anyone should
// have to remember — the server brings its own schema up to date.
package store

import (
	"context"
	"embed"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/natrontech/wattroom/server/internal/store/db"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Store struct {
	Pool    *pgxpool.Pool
	Queries *db.Queries
}

// Open connects, migrates, and returns the ready store. dsn comes from
// WATTROOM_DB; callers treat an empty dsn as "run without a database".
func Open(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("store: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: ping: %w", err)
	}

	// goose speaks database/sql; stdlib borrows from the same pgx pool config.
	goose.SetBaseFS(migrations)
	if err := goose.SetDialect("postgres"); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: goose dialect: %w", err)
	}
	sqldb := stdlib.OpenDBFromPool(pool)
	if err := goose.UpContext(ctx, sqldb, "migrations"); err != nil {
		_ = sqldb.Close()
		pool.Close()
		return nil, fmt.Errorf("store: migrate: %w", err)
	}
	if err := sqldb.Close(); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: release migration conn: %w", err)
	}

	return &Store{Pool: pool, Queries: db.New(pool)}, nil
}

func (s *Store) Close() {
	s.Pool.Close()
}
