-- +goose Up
-- `if not exists` throughout, and renamed off the 00040 collision (#949): the
-- rule that migrations carry a timestamp (#942) landed after this file had
-- already taken the last sequence number (#899), so main could not boot its
-- own test suite. A database that applied this while it was still 00040 —
-- CI, every dev worktree — already has both indexes, and re-running under the
-- new name must be a no-op rather than a failure. Fresh databases are
-- unaffected. Same treatment 00036 got in #931.
--
-- Postgres does not index a foreign key for you, and two of them needed it.
--
-- rides.room_id is a read path: RoomMonthKj and ListRoomRideWeeks filter on it
-- and nothing else, and rides is the table that grows without bound — a row
-- per rider per session, forever. started_at rides along because both queries
-- narrow by it, the same shape as rides_user_started. Partial because solo
-- rides have no room and both callers pass a real one.
create index if not exists rides_room_started on rides (room_id, started_at desc) where room_id is not null;

-- medals.ride_id is a delete path: medals.ride_id references rides on delete
-- cascade, so every DeleteRide and every account purge scanned medals looking
-- for children. medals_room leads with room_id and cannot serve this.
create index if not exists medals_ride on medals (ride_id);

-- +goose Down
drop index if exists rides_room_started;
drop index if exists medals_ride;
