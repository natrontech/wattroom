-- +goose Up

-- ADR-0016: NormPower is a per-ride fact computed at save time; NULL marks a
-- ride the one-pass startup backfill has not read yet. Load and the fitness
-- series are derived from this on read, never stored.
alter table rides add column norm_watts smallint;

-- +goose Down
alter table rides drop column norm_watts;
