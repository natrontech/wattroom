-- +goose Up
-- The delivery is out of date, and the rider is told (#2281). A ride grows
-- after its session closed when a socket replays its buffer late (#1536,
-- stats.AmendRide). If the delivery had already succeeded, the remote keeps
-- the short version for good: StartRideExport's `where state <> 'delivered'`
-- never re-opens a delivered row, and re-posting is not an option — the
-- upload API has no update, so it would be refused as a duplicate.
--
-- So the divergence is recorded rather than repaired, and the ride page says
-- it in one sentence. On ride_exports rather than on rides because the fact
-- is about the delivery: a ride amended while the upload was still pending
-- diverges from nothing, and a second destination delivered at a different
-- moment answers this question for itself.
--
-- Expand/contract (ADR-0019): one nullable column, nothing dropped or
-- renamed. The release before this one never selects it, so rolling back to
-- its image leaves the column sitting unread.
alter table ride_exports add column stale_since timestamptz;

-- +goose Down
alter table ride_exports drop column stale_since;
