-- +goose Up
-- A board holds as many clips as the rider wants (#877 follow-up). Nine came
-- from the mockups, never from SPEC, and riders hit it the first day.
--
-- Dropping a CHECK is safe under expand/contract (ADR-0019) in the direction
-- that matters: the previous image only ever wrote pads 1-9, every one of
-- those is still valid without the constraint, so a rollback keeps working.
-- The worst a rolled-back image does is not draw a pad numbered past its own
-- grid — cosmetic, on a surface the rider can reassign.
alter table board_clips drop constraint board_clips_pad_range;

-- A sanity bound, not a ceiling. A pad is a position in a list and the rider's
-- storage quota is what actually limits how many they can hold; this only
-- stops a hostile client parking a clip at pad 2147483647.
alter table board_clips
    add constraint board_clips_pad_sane check (pad is null or pad between 1 and 999);

-- +goose Down
alter table board_clips drop constraint board_clips_pad_sane;
alter table board_clips
    add constraint board_clips_pad_range check (pad is null or pad between 1 and 9);
