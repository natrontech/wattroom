-- A crew's own emoji (#2643). Every statement is scoped by crew_id, including
-- the ones that already have the emoji's own id — pins.sql's rule: the handler
-- resolved the crew from the path and the membership from that, so an id from
-- another crew must miss rather than be trusted.

-- name: ListCrewEmoji :many
-- Not `bytes`: the listing is what a picker draws from, and each picture is
-- fetched on its own immutable URL.
select id, name, user_id, created_at
from crew_emoji
where crew_id = $1
order by name;

-- name: CountCrewEmoji :one
-- Asked with the crew's row locked (LockCrew), in the transaction that
-- inserts: a count and an insert apart are a ceiling a burst walks through
-- (#1413).
select count(*) from crew_emoji where crew_id = $1;

-- name: CreateCrewEmoji :one
-- A name the crew already has is a unique violation, which the handler
-- answers as a 409 — the constraint rather than a read first, so two members
-- racing for the same :name: cannot both win.
insert into crew_emoji (crew_id, user_id, name, mime, bytes)
values ($1, $2, $3, $4, $5)
returning id, name, user_id, created_at;

-- name: GetCrewEmojiImage :one
select mime, bytes from crew_emoji where id = $1 and crew_id = $2;

-- name: GetCrewEmojiUploader :one
-- Who may delete it is the uploader or the crew's keepers, so the delete
-- reads the uploader first to tell "not yours" (403) from "not here" (404).
select user_id from crew_emoji where id = $1 and crew_id = $2;

-- name: DeleteCrewEmoji :execrows
-- The row count is the answer: 0 means no such emoji in this crew.
delete from crew_emoji where id = $1 and crew_id = $2;
