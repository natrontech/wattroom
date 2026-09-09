-- +goose Up
-- A won game is a ledger fact like a won sprint (#1575): counted, never
-- paid (amount 0) until docs/SPEC.md names a number. Expand only — an
-- older image never writes the value, so the wider check is safe to run
-- under (ADR-0019).
alter table xp_events drop constraint xp_events_source_check;
alter table xp_events add constraint xp_events_source_check check (source in (
    'lounge', 'session', 'achievement', 'sprint_win', 'dj_track', 'coached', 'game_win'
));

-- +goose Down
delete from xp_events where source = 'game_win';
alter table xp_events drop constraint xp_events_source_check;
alter table xp_events add constraint xp_events_source_check check (source in (
    'lounge', 'session', 'achievement', 'sprint_win', 'dj_track', 'coached'
));
