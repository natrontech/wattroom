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
