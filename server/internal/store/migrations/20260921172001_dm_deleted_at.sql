-- +goose Up
-- A deleted direct message leaves a tombstone (#2418), where a deleted room
-- line vanishes (#2417). Two reasons, and they point the same way.
--
-- The forcing one is delivery. A room has a socket: the hub tells everyone
-- holding it open that a line is gone. A DM is POLLED, and the poll merges
-- by id and never removes — `after` narrows it to messages created since, so
-- absence from a page means "not new", not "deleted". Saying "gone" would
-- need either a tombstone or the whole pair's id list on every poll.
--
-- The one that would hold anyway: a room is a crowd and a line scrolls past,
-- but a DM is one other person who was talking to you, and a message
-- silently disappearing from a two-person thread reads as "did I imagine
-- that?". Every messenger that has faced this — WhatsApp, Signal, Telegram —
-- tombstones a DM, and Discord vanishes a channel line.
--
-- The row stays; the handler empties `text` and drops `image_id`, so the
-- words are gone from the database and the picture stops being served and is
-- swept by PruneDmImages like any other unreferenced blob. What is left is
-- the fact that something was here.
--
-- Expand/contract (ADR-0019): a release only ADDS — one nullable column, no
-- default, no backfill.
alter table dm_messages add column deleted_at timestamptz;

-- +goose Down
alter table dm_messages drop column deleted_at;
