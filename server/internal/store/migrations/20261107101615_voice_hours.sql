-- +goose Up
-- Hangout time in the cozy room (docs/spec/lounge.md): each rider's seconds
-- in voice, and each crew's seconds with two or more of its riders in one
-- voice channel. The hub adds a minute at a time and a keeper writes them in
-- batches. Counters, not a ledger: neither pays XP or Batzen.
--
-- Expand only (ADR-0019): two new tables the release before this one never
-- reads.
create table user_voice_time (
    user_id uuid   primary key references users (id) on delete cascade,
    seconds bigint not null default 0 check (seconds >= 0)
);

create table crew_together (
    crew_id uuid   primary key references crews (id) on delete cascade,
    seconds bigint not null default 0 check (seconds >= 0)
);

-- +goose Down
drop table if exists crew_together;
drop table if exists user_voice_time;
