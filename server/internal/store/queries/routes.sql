-- name: CreateRoute :one
insert into routes (
    owner_id, src, name, gen_name, road, road_hash, length_m, gain_m,
    climbs, ele_source, geom_sealed, key_version, road_sealed
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
       ele_source, (geom_sealed is not null)::boolean as has_place, created_at,
       road_sealed, key_version
from routes
where id = $1 and owner_id = $2;

-- name: GetOwnerRoutePlace :one
-- The sealed place, for its owner alone (ADR-0063) — and for nobody else,
-- which the where clause says rather than a caller remembering to.
select geom_sealed, key_version, length_m from routes where id = $1 and owner_id = $2;

-- name: RenameRoute :execrows
update routes set name = $3 where id = $1 and owner_id = $2;

-- name: DeleteRoute :execrows
delete from routes where id = $1 and owner_id = $2;

-- name: ListRoutesSealedUnder :many
-- The re-seal's read: a batch of rows sealed under one key version.
select id, geom_sealed, road_sealed from routes
where key_version = $1
order by id
limit $2;

-- name: ResealRoute :execrows
-- Only while the row still carries the version it was read under, so a
-- concurrent re-seal cannot overwrite a newer seal with an older one.
update routes set geom_sealed = sqlc.arg(geom_sealed), road_sealed = sqlc.narg(road_sealed),
       key_version = sqlc.arg(new_version)
where id = sqlc.arg(id) and key_version = sqlc.arg(old_version);

-- name: ExportUserRoutes :many
-- Every route the rider stored, for the export (ADR-0053): the road and the
-- sealed place with it, since the GPX is built from both. Bounded like every
-- category a rider runs up a row at a time. Each route carries the answers
-- its owner gave crews listed in the directory (#3569), by the crew's name
-- as it is now.
select id, src, name, gen_name, road, length_m, gain_m, climbs, ele_source,
       geom_sealed, key_version, created_at, road_sealed,
       coalesce((select jsonb_agg(jsonb_build_object(
                     'crewId', a.crew_id, 'crew', c.name, 'shared', a.shared, 'decidedAt', a.decided_at)
                     order by a.decided_at)
                 from route_crew_consents a join crews c on c.id = a.crew_id
                 where a.route_id = routes.id), '[]'::jsonb)::jsonb as crew_answers
from routes
where routes.owner_id = sqlc.arg(user_id)
order by routes.created_at
limit sqlc.arg(lim);

-- name: GetRouteRoad :one
-- A route's road, its source and whose it is (#3051): what a workout read
-- cuts to its reader. Deliberately not owner-scoped — the cut is the
-- audience rule, and routes.Attacher is the one place that applies it.
select owner_id, src, road, road_sealed, key_version, road_hash, length_m from routes where id = $1;

-- name: GetRouteGenName :one
-- The name a route goes out under beyond its owner (#3055, ADR-0063): the
-- generated one, never the owner's rename.
select gen_name from routes where id = $1;

-- name: ListRoutesWithRoadInTheClear :many
-- The boot's sealing of roads stored before #3511, a page at a time by id:
-- every row with nothing sealed yet. ponytail: a keyless server's rows never
-- leave this list, so each boot reads them again and finds them already
-- bare; a marker column is the upgrade once that read shows at boot.
select id, road, key_version from routes
where road_sealed is null and id > sqlc.arg(after)::uuid
order by id
limit sqlc.arg(lim);

-- name: SealRouteRoad :execrows
-- One row's road sealed and stripped, only while it is still as it was read:
-- nothing sealed yet, under the same key version.
update routes set road = sqlc.arg(road), road_sealed = sqlc.narg(road_sealed)
where id = sqlc.arg(id) and road_sealed is null
  and key_version is not distinct from sqlc.narg(key_version);

-- name: RouteAudienceCrews :many
-- The crews through which a rider may read a route that is not theirs (#3096):
-- one of their crews whose unstarted plan carries it, or one whose channel —
-- one they may enter — is riding it right now (the hub names those). Each with
-- whether it is listed in the directory and what the owner answered for it.
select c.id, c.listed, a.shared as consent
from crews c
left join route_crew_consents a on a.route_id = sqlc.arg(route_id) and a.crew_id = c.id
where (
    exists (select 1 from scheduled_sessions s
            where s.crew_id = c.id and s.route_id = sqlc.arg(route_id) and s.started_at is null)
    and (c.owner_id = sqlc.arg(viewer)
         or exists (select 1 from crew_roles cr
                    where cr.crew_id = c.id and cr.user_id = sqlc.arg(viewer) and cr.role in ('member', 'admin')))
) or exists (
    select 1 from channels ch
    join visible_channels v on v.channel_id = ch.id and v.user_id = sqlc.arg(viewer)
    where ch.crew_id = c.id and ch.id = any(sqlc.arg(riding)::uuid[])
);

-- name: SetRouteCrewConsent :exec
-- The owner's answer for one crew; a later answer replaces it.
insert into route_crew_consents (route_id, crew_id, shared)
values ($1, $2, $3)
on conflict (route_id, crew_id) do update set shared = excluded.shared, decided_at = now();

-- name: GetRoutePlace :one
-- A route's sealed place and length by id alone (#3096): for the crew tier of
-- /shape, which cuts it to the span between the anchors. Not owner-scoped —
-- routes.Service's audience is the rule, and the only caller asks it first.
select owner_id, src, geom_sealed, key_version, length_m from routes where id = $1;

-- name: CountUserRoutes :one
-- The routes one rider keeps, against docs/SPEC.md's shelf ceiling (#3416):
-- read under their row lock in the transaction that inserts.
select count(*)::integer from routes where owner_id = $1;
