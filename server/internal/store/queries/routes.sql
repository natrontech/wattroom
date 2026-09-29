-- name: CreateRoute :one
insert into routes (
    owner_id, src, name, gen_name, road, road_hash, length_m, gain_m,
    climbs, ele_source, geom_sealed, key_version
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
returning id, created_at;

-- name: ListOwnerRoutes :many
-- The owner's list (#3024): summary columns only — the road and the sealed
-- place stay cold until one route is opened.
select id, src, name, gen_name, length_m, gain_m, climbs,
       (geom_sealed is not null)::boolean as has_place, created_at
from routes
where owner_id = $1
order by created_at desc, id desc;

-- name: GetOwnerRoute :one
-- One route, the owner's only: someone else's reads as absent.
select id, src, name, gen_name, road, road_hash, length_m, gain_m, climbs,
       ele_source, (geom_sealed is not null)::boolean as has_place, created_at
from routes
where id = $1 and owner_id = $2;

-- name: GetOwnerRoutePlace :one
-- The sealed place, for its owner alone (ADR-0063) — and for nobody else,
-- which the where clause says rather than a caller remembering to.
select geom_sealed, key_version from routes where id = $1 and owner_id = $2;

-- name: RenameRoute :execrows
update routes set name = $3 where id = $1 and owner_id = $2;

-- name: DeleteRoute :execrows
delete from routes where id = $1 and owner_id = $2;

-- name: ListRoutesSealedUnder :many
-- The re-seal's read: a batch of rows sealed under one key version.
select id, geom_sealed from routes
where key_version = $1
order by id
limit $2;

-- name: ResealRoute :execrows
-- Only while the row still carries the version it was read under, so a
-- concurrent re-seal cannot overwrite a newer seal with an older one.
update routes set geom_sealed = sqlc.arg(geom_sealed), key_version = sqlc.arg(new_version)
where id = sqlc.arg(id) and key_version = sqlc.arg(old_version);

-- name: ExportUserRoutes :many
-- Every route the rider stored, for the export (ADR-0053): the road and the
-- sealed place with it, since the GPX is built from both. Bounded like every
-- category a rider runs up a row at a time.
select id, src, name, gen_name, road, length_m, gain_m, climbs, ele_source,
       geom_sealed, key_version, created_at
from routes
where owner_id = sqlc.arg(user_id)
order by created_at
limit sqlc.arg(lim);
