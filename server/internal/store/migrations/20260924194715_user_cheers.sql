-- +goose Up
-- A rider's own reaction set (#2722): the mid-ride cheer buttons and the head
-- of the chat picker follow the rider, not the crew. The crew's convention —
-- space-joined, '' is the base set — so every existing rider starts on it.
--
-- Expand/contract (ADR-0019): crews.cheers stops being read with this release
-- and is dropped one release after it.
alter table users add column cheers text not null default '';

-- +goose Down
alter table users drop column cheers;
