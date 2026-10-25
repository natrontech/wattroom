-- +goose Up
-- The rider's own figure (ADR-0073, #3342): chosen on one skippable card, never
-- derived from weight (ADR-0048). All nullable: null build, height or skin is
-- the neutral figure's value. `figure_asked_at` is set by a save or a skip, so
-- the card never returns on any device. `skin` indexes the 8 swatches of
-- docs/spec/garage.md; the bounds are the spec's.
alter table users
    add column build           text     check (build is null or build in ('slim', 'athletic', 'strong')),
    add column height_cm       smallint check (height_cm is null or height_cm between 150 and 205),
    add column skin            smallint check (skin is null or skin between 0 and 7),
    add column figure_asked_at timestamptz;

-- +goose Down
alter table users drop column build, drop column height_cm, drop column skin, drop column figure_asked_at;
