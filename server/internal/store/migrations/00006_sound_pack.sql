-- +goose Up
-- Sound pack is a room property (owner-set, docs mock: "ships with every
-- room"): 'base' = the synthwave cue set, 'silent' = visual cues only.
alter table rooms
    add column sound_pack text not null default 'base'
    check (sound_pack in ('base', 'silent'));

-- +goose Down
alter table rooms drop column sound_pack;
