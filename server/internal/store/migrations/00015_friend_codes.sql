-- +goose Up
-- ADR-0012 amendment: friend requests form only through a shared friend code —
-- no candidate listing. translate() maps md5 hex onto a read-aloud-safe
-- alphabet (no 0/O/1/I/L), same idea as room codes. The volatile default
-- backfills every existing row with its own code.
-- ponytail: random() is not crypto — a code only grants "may send a request",
-- 16^8 space; switch to gen_random_uuid()-derived if that ever matters.
alter table users add column friend_code text not null unique
    default translate(substr(md5(random()::text), 1, 8), '0123456789abcdef', 'ABCDEFGHJKMNPQRS');

-- +goose Down
alter table users drop column friend_code;
