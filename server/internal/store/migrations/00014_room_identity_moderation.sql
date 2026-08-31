-- +goose Up
-- Room identity & vocabulary (#223): an emoji icon and the owner-curated
-- reaction palette (WATTROOM.md feel layer: reaction sets swappable per room).
-- '' means "no icon" / "base set" — the defaults live in code, not in rows.
alter table rooms add column icon text not null default '';
alter table rooms add column cheers text not null default '';

-- Moderation (#223): a ban is a membership that keeps the seat occupied —
-- rejoining via link or code hits ON CONFLICT DO NOTHING and stays banned.
alter table memberships drop constraint memberships_role_check;
alter table memberships add constraint memberships_role_check
    check (role in ('owner', 'coach', 'member', 'banned'));

-- +goose Down
alter table memberships drop constraint memberships_role_check;
alter table memberships add constraint memberships_role_check
    check (role in ('owner', 'coach', 'member'));
alter table rooms drop column cheers;
alter table rooms drop column icon;
