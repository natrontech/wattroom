-- +goose Up
-- The wardrobe and the outfit (#3153, ADR-0069, ADR-0073).
--
-- `wardrobe` is what a rider owns: one row per item, by the catalogue's id
-- (server/internal/wardrobe/catalogue.go), and how it came — bought with
-- Batzen, earned by an achievement, a medal or a streak, or with a frame.
-- An item that is free to everyone is owned by nobody in particular and has
-- no row. `first_worn_at` is set the first ride the item is worn on, which is
-- what ends a purchase's undo (docs/SPEC.md "Wardrobe").
--
-- `outfits` is what a rider's figure wears (docs/SPEC.md: one owned item per
-- slot), the loadout as the client builds it; one per rider.
--
-- Add-only (ADR-0019): new tables the release before this one never reads.
create table wardrobe (
    user_id       uuid not null references users (id) on delete cascade,
    item_id       text not null,
    source        text not null check (source in ('bought', 'earned', 'with')),
    acquired_at   timestamptz not null default now(),
    first_worn_at timestamptz,
    primary key (user_id, item_id)
);

create table outfits (
    user_id    uuid primary key references users (id) on delete cascade,
    loadout    jsonb not null,
    updated_at timestamptz not null default now()
);

-- +goose Down
drop table if exists outfits;
drop table if exists wardrobe;
