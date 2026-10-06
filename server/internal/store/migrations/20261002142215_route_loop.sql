-- +goose Up
-- Whether a route ends where it began (#3680): the route page's stat row
-- says loop or point to point. The browser parses the file and knows it from
-- the whole line; a road's heights and turns cannot tell it back, and the
-- line itself is sealed or not kept at all. Null is a route stored before
-- this shipped, which says neither.
--
-- Add-only (ADR-0019): one nullable column the release before this one never
-- reads.
alter table routes add column loop boolean;

-- +goose Down
alter table routes drop column if exists loop;
