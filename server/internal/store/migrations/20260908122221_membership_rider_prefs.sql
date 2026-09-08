-- +goose Up
-- A rider's own settings for one room (#1100). Until now every room-related
-- preference was either the owner's decision for everybody or a global app
-- setting, with nothing in between.
--
-- `memberships` is already the per-rider, per-room row, so the preferences
-- hang off it and there is no new table. Two columns, because those are the
-- two with something that reads them:
--
--   notify    narrows the GLOBAL users.notify_planned to one room.
--             ListRoomNotifyTargets already joins memberships and filters on
--             the global flag; this is one more clause on a query that exists.
--   on_board  keeps a rider off the room's weekly board (ADR-0036, amended
--             by this change). RoomWeekBoard already joins memberships to
--             prove the rider is still in the room.
--
-- A third preference the issue proposed — "start this room muted for me" —
-- deliberately does NOT live here. The mixer is device-local
-- (`wattroom.mixer.v1`), and a rider's speakers are a property of the machine
-- they are sitting at, not of their membership: storing it would sync one
-- room's volume decision onto every other device they own.
--
-- BOTH DEFAULT TRUE, which is exactly today's behaviour for every existing
-- row: everyone who gets planned-session mail keeps getting it, and everyone
-- on a board-enabled room's board stays on it. A migration that silently
-- opts people out is the same failure as one that opts them in.
--
-- Leaving a room DROPS this row, so preferences reset to the defaults on
-- rejoining. That is a consequence of where they live rather than a rule
-- enforced anywhere, so it is written down here and tested rather than left
-- for someone to discover.
--
-- Expand/contract (ADR-0019): two defaulted columns, nothing dropped. The
-- previous release reads every row unchanged and a rollback loses only the
-- preferences, which is the mildest possible loss — everyone reverts to the
-- behaviour the defaults describe.
alter table memberships add column if not exists notify boolean not null default true;
alter table memberships add column if not exists on_board boolean not null default true;

-- +goose Down
alter table memberships drop column if exists on_board;
alter table memberships drop column if exists notify;
