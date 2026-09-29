-- name: ExportUserWardrobe :many
-- What the rider owns, for the export (ADR-0053): by the catalogue's id, how
-- it came and when, oldest first. Bounded like every category a rider runs up
-- a row at a time.
select item_id, source, acquired_at, first_worn_at from wardrobe
where user_id = sqlc.arg(user_id)
order by acquired_at, item_id
limit sqlc.arg(lim);

-- name: GetUserOutfit :one
-- What the rider's figure wears (docs/SPEC.md: one owned item per slot).
select loadout, updated_at from outfits where user_id = $1;

-- name: GetWardrobeItem :one
-- One item the rider owns, read under their row lock: how it came, when,
-- and whether it has been worn on a ride — what an undo asks (#3154).
select source, acquired_at, first_worn_at from wardrobe
where user_id = $1 and item_id = $2;

-- name: AddWardrobeItem :one
insert into wardrobe (user_id, item_id, source)
values ($1, $2, $3)
returning acquired_at;

-- name: RemoveUnwornWardrobeItem :execrows
-- An undone purchase leaves the wardrobe — only while never worn on a ride.
delete from wardrobe
where user_id = $1 and item_id = $2 and first_worn_at is null;

-- name: ListOwnedItems :many
select item_id from wardrobe where user_id = $1;

-- name: SetOutfit :exec
-- What the rider's figure wears, as the client built it, checked before
-- this: one per rider, replaced whole.
insert into outfits (user_id, loadout) values ($1, $2)
on conflict (user_id) do update set loadout = excluded.loadout, updated_at = now();

-- name: TakeOffItem :exec
-- An undone purchase comes off the outfit too: its slot falls back to what
-- the client starts every rider in.
update outfits set loadout = loadout - sqlc.arg(slot)::text, updated_at = now()
where user_id = sqlc.arg(user_id) and loadout ->> sqlc.arg(slot)::text = sqlc.arg(item_id)::text;

-- name: MarkOutfitWorn :exec
-- A saved ride wears the outfit (#3154): every owned item it holds is worn
-- from now on, which ends a purchase's undo (docs/SPEC.md "Wardrobe").
update wardrobe w set first_worn_at = now()
from outfits o, jsonb_each_text(o.loadout) as slot(name, item)
where o.user_id = sqlc.arg(user_id) and w.user_id = sqlc.arg(user_id)
  and w.item_id = slot.item and w.first_worn_at is null;
