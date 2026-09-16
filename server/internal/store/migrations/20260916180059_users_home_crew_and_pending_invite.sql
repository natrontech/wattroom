-- +goose Up
-- Two things an account remembers about crews (#2144, ADR-0038 amended).
--
-- pending_crew_code: the invite a signed-in rider was sent to and has not
-- joined. The deep link lived in one browser tab, and a new account's email
-- confirmation opens another, so the rider came back to an empty Home. The
-- door writes it; /api/me derives the invite from it while the rider is in no
-- crew and the code still opens one; the join clears it.
--
-- home_crew_id: the crew the sidebar opens in on every device, chosen by a
-- rider who is in more than one. Set null with the crew: a main crew that no
-- longer exists is no crew, and the client falls back the way it always did.
--
-- Expand/contract (ADR-0019): two nullable columns, nothing dropped, so the
-- release before this one runs against this schema untouched.
alter table users
    add column pending_crew_code text,
    add column home_crew_id uuid references crews (id) on delete set null;

-- +goose Down
alter table users
    drop column pending_crew_code,
    drop column home_crew_id;
