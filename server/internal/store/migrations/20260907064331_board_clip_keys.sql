-- +goose Up
-- A pad's key stops being its number (#877 follow-up). It was implicit — pad 3
-- fired on "3" — which meant keys could not be changed, could not be removed,
-- and could not exist at all past pad 9 once the board grew.
alter table board_clips add column key text;

-- Keep every board sounding exactly as it does today: the nine pads that had a
-- working digit keep it, written down this time so the rider can change it.
update board_clips set key = pad::text where pad between 1 and 9;

-- One key per rider: pressing it has to mean one clip. Partial, so the many
-- clips with no key at all do not collide with each other.
create unique index board_clips_key on board_clips (user_id, key)
where key is not null;

-- +goose Down
drop index board_clips_key;
alter table board_clips drop column key;
