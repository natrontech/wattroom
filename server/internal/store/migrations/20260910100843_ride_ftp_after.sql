-- +goose Up
-- The FTP a ride PRODUCED, as opposed to ftp_watts, the one it was scored
-- against (#1572). A ramp test is a ride (#1562), and its row carries the old
-- number — so the FTP trend could not draw the one event it exists for until
-- the rider rode again. Null on every ordinary ride; set only when a ramp's
-- result is accepted, which is why it is nullable rather than defaulted.
--
-- Expand/contract (ADR-0019): a release only ADDS — nullable columns, new
-- tables, new indexes. Dropping or renaming happens one release AFTER the
-- release whose code stopped reading the thing. Nothing backfills existing
-- ramp rides: the number they produced is not recoverable from the row.
alter table rides add column ftp_after_watts smallint
    check (ftp_after_watts is null or ftp_after_watts between 50 and 600);

-- +goose Down
alter table rides drop column ftp_after_watts;
