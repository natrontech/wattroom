-- +goose Up

-- Postgres does not index a foreign key for you, and two of them needed it.
--
-- rides.room_id is a read path: RoomMonthKj and ListRoomRideWeeks filter on it
-- and nothing else, and rides is the table that grows without bound — a row
-- per rider per session, forever. started_at rides along because both queries
-- narrow by it, the same shape as rides_user_started. Partial because solo
-- rides have no room and both callers pass a real one.
create index rides_room_started on rides (room_id, started_at desc) where room_id is not null;

-- medals.ride_id is a delete path: medals.ride_id references rides on delete
-- cascade, so every DeleteRide and every account purge scanned medals looking
-- for children. medals_room leads with room_id and cannot serve this.
create index medals_ride on medals (ride_id);

-- +goose Down
drop index rides_room_started;
drop index medals_ride;
