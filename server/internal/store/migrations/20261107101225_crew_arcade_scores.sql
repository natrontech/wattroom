-- +goose Up
-- The arcade's games, a crew's best per rider per game per UTC day: the daily
-- course's board, and from it the all-time best, a rider's own best and the
-- weekly cup (docs/spec/lounge.md). Töggeli keeps matches won that day.
create table crew_arcade_scores (
    crew_id uuid        not null references crews (id) on delete cascade,
    game    text        not null,
    user_id uuid        not null references users (id) on delete cascade,
    day     date        not null,
    score   integer     not null,
    set_at  timestamptz not null default now(),
    primary key (crew_id, game, day, user_id)
);
create index crew_arcade_scores_user on crew_arcade_scores (user_id);

-- Bergpreis's bests so far, on the day each was set. crew_arcade stays until
-- the release after this one stops reading it.
insert into crew_arcade_scores (crew_id, game, user_id, day, score, set_at)
select crew_id, 'bergpreis', user_id, (set_at at time zone 'utc')::date, score, set_at
from crew_arcade;

-- +goose Down
drop table if exists crew_arcade_scores;
