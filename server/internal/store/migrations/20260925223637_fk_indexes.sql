-- +goose Up

-- Postgres does not index a foreign key for you (#891), and 31 had no index
-- leading with their columns (#2841). Without one, deleting the parent — a
-- channel, an account — scans the whole child table for what to cascade or
-- null, and a filter on the column does the same. rides and medals are the
-- tables that grow for ever. store/fk_index_test.go now fails on the next
-- foreign key that lands without its index.
--
-- Add-only (ADR-0019): an index is safe to leave behind on a rollback.

-- rides.channel_id arrived with the move to channels without the index #891
-- gave rides.room_id; same shape, for the same reason.
create index rides_channel_started on rides (channel_id, started_at desc) where channel_id is not null;
-- Every XP event runs UserMedalTally, which counts one rider's medals by kind.
create index medals_user_kind on medals (user_id, kind);
-- The DM heads poll filters on sender or recipient every ten seconds from
-- every open tab; created_at rides along for the newest line per pair.
create index dm_messages_sender_time on dm_messages (sender_id, created_at desc);
create index dm_messages_recipient_time on dm_messages (recipient_id, created_at desc);

create index channel_members_added_by on channel_members (added_by);
create index channel_reads_user on channel_reads (user_id);
create index channels_announcement on channels (announcement_id);
create index channels_autoplay_playlist on channels (autoplay_playlist_id);
create index chat_images_channel on chat_images (channel_id);
create index chat_images_user on chat_images (user_id);
create index chat_messages_user on chat_messages (user_id);
create index chat_reactions_user on chat_reactions (user_id);
create index crew_pins_created_by on crew_pins (created_by);
create index crews_owner on crews (owner_id);
create index dm_images_recipient on dm_images (recipient_id);
create index dm_images_sender on dm_images (sender_id);
create index dm_reactions_user on dm_reactions (user_id);
create index dm_reads_peer on dm_reads (peer_id);
create index friend_declines_addressee on friend_declines (addressee_id);
create index friendships_addressee on friendships (addressee_id);
create index moved_rooms_crew on moved_rooms (crew_id);
create index moved_rooms_text_channel on moved_rooms (text_channel_id);
create index moved_rooms_voice_channel on moved_rooms (voice_channel_id);
create index scheduled_sessions_channel on scheduled_sessions (channel_id);
create index scheduled_sessions_created_by on scheduled_sessions (created_by);
create index session_recaps_channel on session_recaps (channel_id);
create index session_rsvps_user on session_rsvps (user_id);
create index sessions_user on sessions (user_id);
create index track_plays_queued_by on track_plays (queued_by);
create index track_plays_track on track_plays (track_id);
create index users_home_crew on users (home_crew_id);

-- Not a foreign key: the calendar feed looks a rider up by this token on
-- every poll a calendar app makes, and it had no index at all.
create index users_ics_token on users (ics_token);

-- +goose Down
drop index if exists rides_channel_started;
drop index if exists medals_user_kind;
drop index if exists dm_messages_sender_time;
drop index if exists dm_messages_recipient_time;
drop index if exists channel_members_added_by;
drop index if exists channel_reads_user;
drop index if exists channels_announcement;
drop index if exists channels_autoplay_playlist;
drop index if exists chat_images_channel;
drop index if exists chat_images_user;
drop index if exists chat_messages_user;
drop index if exists chat_reactions_user;
drop index if exists crew_pins_created_by;
drop index if exists crews_owner;
drop index if exists dm_images_recipient;
drop index if exists dm_images_sender;
drop index if exists dm_reactions_user;
drop index if exists dm_reads_peer;
drop index if exists friend_declines_addressee;
drop index if exists friendships_addressee;
drop index if exists moved_rooms_crew;
drop index if exists moved_rooms_text_channel;
drop index if exists moved_rooms_voice_channel;
drop index if exists scheduled_sessions_channel;
drop index if exists scheduled_sessions_created_by;
drop index if exists session_recaps_channel;
drop index if exists session_rsvps_user;
drop index if exists sessions_user;
drop index if exists track_plays_queued_by;
drop index if exists track_plays_track;
drop index if exists users_home_crew;
drop index if exists users_ics_token;
