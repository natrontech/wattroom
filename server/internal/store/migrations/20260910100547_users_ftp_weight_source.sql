-- +goose Up
-- Where the two numbers every FTP-relative target scales from came from
-- (#1484). `ftp_watts` has defaulted to 200 and `weight_kg` to 75 since
-- 00001_init, and nothing in the first hour asked: a rider who was never
-- asked rode sweet-spot at 0.9 x 200 W, and their execution score, XP bonus,
-- category and load were all anchored to a number nobody chose — printed on
-- Home with the same authority as a measured one. Recording the provenance is
-- what lets the app say "a starting guess" and what lets the first-run step
-- know it has been answered.
--
-- 'default' nobody chose it; 'manual' the rider set it (typed, or accepted a
-- suggestion); 'ramp' a ramp test measured it. Weight is never ramp-derived —
-- the same CHECK on both keeps one vocabulary rather than two.
--
-- Expand/contract (ADR-0019): both columns nullable with a default, nothing
-- dropped. The release before this one does not name them in its INSERT, so
-- the column default is what stamps a new account 'default' if that code runs
-- again after a rollback.
alter table users
    add column ftp_source    text default 'default'
        check (ftp_source is null or ftp_source in ('default', 'manual', 'ramp')),
    add column weight_source text default 'default'
        check (weight_source is null or weight_source in ('default', 'manual', 'ramp'));

-- Existing accounts, inferred from the only evidence there is: a row still
-- holding the exact default was almost certainly never asked, and anything
-- else was set by somebody. A rider who genuinely weighs 75 kg is told their
-- weight is a guess until they save it once — the wrong way round would tell
-- a rider their untouched 200 W was measured, which is the bug this fixes.
update users set ftp_source    = case when ftp_watts = 200 then 'default' else 'manual' end,
                 weight_source = case when weight_kg = 75  then 'default' else 'manual' end;

-- +goose Down
alter table users drop column ftp_source, drop column weight_source;
