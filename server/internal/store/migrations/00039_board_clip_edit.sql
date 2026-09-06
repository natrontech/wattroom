-- +goose Up
-- The edit a rider makes to a clip (#934), stored as numbers beside the audio
-- rather than baked into it (ADR-0033). Every listener already decodes the
-- whole file, so trim, gain and fades are applied at playback: no encoder in
-- the browser, no second copy of the audio, and the edit stays re-editable
-- forever because the source is never touched.
--
-- Additive with defaults that mean "the whole file at unity", so every clip
-- that exists keeps sounding exactly as it does today (expand/contract,
-- ADR-0019).
alter table board_clips
    add column start_ms integer not null default 0,
    -- 0 means "to the end of the source" — a clip uploaded before this
    -- migration has no end to record, and the playback side reads it that way.
    add column end_ms integer not null default 0,
    add column gain_db real not null default 0,
    add column fade_in_ms integer not null default 0,
    add column fade_out_ms integer not null default 0;

-- +goose Down
alter table board_clips
    drop column start_ms,
    drop column end_ms,
    drop column gain_db,
    drop column fade_in_ms,
    drop column fade_out_ms;
