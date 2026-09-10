-- +goose Up
-- Deleting a ride does not un-ride it (#1452, ADR-0047). The delete is a hard
-- delete, so the ride leaves `sum(rides.xp)`; this source is the offsetting
-- row that puts the same amount back into the ledger, and `user_total_xp` —
-- rides plus ledger — comes out unchanged. docs/SPEC.md's "Level — only goes
-- up" is the invariant being kept. `ref` is the deleted ride's id.
-- Expand only — an older image never writes the value, so the wider check is
-- safe to run under (ADR-0019).
alter table xp_events drop constraint xp_events_source_check;
alter table xp_events add constraint xp_events_source_check check (source in (
    'lounge', 'session', 'achievement', 'sprint_win', 'dj_track', 'coached',
    'game_win', 'ride_deleted'
));

-- +goose Down
delete from xp_events where source = 'ride_deleted';
alter table xp_events drop constraint xp_events_source_check;
alter table xp_events add constraint xp_events_source_check check (source in (
    'lounge', 'session', 'achievement', 'sprint_win', 'dj_track', 'coached',
    'game_win'
));
