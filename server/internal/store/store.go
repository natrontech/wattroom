// Package store owns the Postgres connection and the schema's lifecycle.
//
// Migrations are embedded and run at startup: the deploy is one binary on one
// VM (ADR-0002), so "migrate then start" is not a pipeline step anyone should
// have to remember — the server brings its own schema up to date.
package store

import (
	"context"
	"embed"
	"errors"
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

// ErrUnreachable wraps the errors that mean "no database", as opposed to a
// database that answered and then refused — a migration it will not take,
// say. Tests skip on the first and must fail on the second: for most of a
// day the rooms suite passed green by skipping every test, because the
// shared database had taken a neighbour's newer migration first and goose
// refused the older one as missing (2026-09-09, #928's cousin).
var ErrUnreachable = errors.New("database unreachable")

// Open connects, migrates, and returns the ready store. dsn comes from
// WATTROOM_DB; callers treat an empty dsn as "run without a database".
func Open(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("store: connect: %w (%w)", err, ErrUnreachable)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: ping: %w (%w)", err, ErrUnreachable)
	}

	// One migrator at a time (2026-09-09): `go test ./...` opens the shared
	// test database from every package at once, and goose racing itself
	// there failed with "relation already exists" — which the harness used
	// to swallow as a skip and now fails, honestly, on one run in three.
	// Two server replicas booting together would race the same way. A
	// session-level advisory lock held on its own connection serialises
	// them; whoever comes second finds nothing left to apply.
	lock, err := pool.Acquire(ctx)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: migrate lock conn: %w", err)
	}
	if _, err := lock.Exec(ctx, "select pg_advisory_lock($1)", migrateLockKey); err != nil {
		lock.Release()
		pool.Close()
		return nil, fmt.Errorf("store: migrate lock: %w", err)
	}
	err = migrate(ctx, pool)
	if _, unlockErr := lock.Exec(ctx, "select pg_advisory_unlock($1)", migrateLockKey); unlockErr != nil && err == nil {
		err = fmt.Errorf("store: migrate unlock: %w", unlockErr)
	}
	lock.Release()
	if err != nil {
		pool.Close()
		return nil, err
	}

	return &Store{Pool: pool, Queries: db.New(pool)}, nil
}

// migrateLockKey is the advisory-lock key migration runs under: arbitrary,
// and the same for every process that opens this database.
const migrateLockKey = 7702_2026_0909

// migrate applies every pending migration; the caller holds the lock.
func migrate(ctx context.Context, pool *pgxpool.Pool) error {
	// goose speaks database/sql; stdlib borrows from the same pgx pool config.
	goose.SetBaseFS(migrations)
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("store: goose dialect: %w", err)
	}
	sqldb := stdlib.OpenDBFromPool(pool)
	if err := goose.UpContext(ctx, sqldb, "migrations"); err != nil {
		_ = sqldb.Close()
		return fmt.Errorf("store: migrate: %w", err)
	}
	if err := sqldb.Close(); err != nil {
		return fmt.Errorf("store: release migration conn: %w", err)
	}
	return nil
}

func (s *Store) Close() {
	s.Pool.Close()
}
