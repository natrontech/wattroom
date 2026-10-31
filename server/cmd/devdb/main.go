// Creates, drops and lists a checkout's databases for scripts/dev-env.sh, over
// the Postgres port rather than `docker exec` into the container: an agent's
// sandbox may reach localhost:5432 but never the Docker socket, and the host
// has no psql. Docker is needed for `make infra` alone.
//
// Usage:
//
//	devdb ensure NAME      create NAME unless it exists
//	devdb drop NAME...     drop each NAME, closing its connections
//	devdb list             every database name, one per line
//
// WATTROOM_PG_DSN_PREFIX names the server (default: the compose dev one); the
// statements run in its maintenance database, `postgres`.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
)

const defaultPrefix = "postgres://wattroom:wattroom@localhost:5432" //nolint:gosec // compose dev credentials, same literal as docker-compose.yml

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "devdb:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return errors.New("usage: devdb ensure NAME | drop NAME... | list")
	}
	prefix := os.Getenv("WATTROOM_PG_DSN_PREFIX")
	if prefix == "" {
		prefix = defaultPrefix
	}
	conn, err := pgx.Connect(ctx, strings.TrimSuffix(prefix, "/")+"/postgres")
	if err != nil {
		return fmt.Errorf("cannot reach Postgres at %s — run `make infra` (in any checkout: it starts the shared server): %w", redact(prefix), err)
	}
	defer func() { _ = conn.Close(ctx) }()

	switch cmd, names := args[0], args[1:]; {
	case cmd == "ensure" && len(names) == 1:
		return ensure(ctx, conn, names[0])
	case cmd == "drop" && len(names) > 0:
		for _, name := range names {
			if _, err := conn.Exec(ctx, "drop database if exists "+pgx.Identifier{name}.Sanitize()+" with (force)"); err != nil {
				return fmt.Errorf("drop %s: %w", name, err)
			}
			fmt.Println("dropped database", name)
		}
		return nil
	case cmd == "list" && len(names) == 0:
		rows, err := conn.Query(ctx, "select datname from pg_database order by datname")
		if err != nil {
			return err
		}
		all, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		for _, name := range all {
			fmt.Println(name)
		}
		return nil
	}
	return fmt.Errorf("unknown command %q", strings.Join(args, " "))
}

// ensure is idempotent: dev-env.sh calls it on every `make dev-server`.
func ensure(ctx context.Context, conn *pgx.Conn, name string) error {
	var exists bool
	if err := conn.QueryRow(ctx, "select exists(select 1 from pg_database where datname = $1)", name).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	if _, err := conn.Exec(ctx, "create database "+pgx.Identifier{name}.Sanitize()); err != nil {
		return fmt.Errorf("could not create database %s: %w", name, err)
	}
	fmt.Println("created database", name)
	return nil
}

// redact drops the password from a DSN prefix before it reaches a terminal.
func redact(prefix string) string {
	at := strings.LastIndex(prefix, "@")
	scheme := strings.Index(prefix, "://")
	if at < 0 || scheme < 0 {
		return prefix
	}
	return prefix[:scheme+3] + "…" + prefix[at:]
}
