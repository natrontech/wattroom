-- +goose Up
-- Appearance follows the account (#326): the palette identity and the scheme
-- toggle were browser-local, so the TV in the next room was Outrun again.
-- Null means no device has chosen yet; '' means the default was chosen on
-- purpose — the client tells the two apart. Expand-only (ADR-0019).
alter table users
    add column accent_palette text,
    add column color_scheme text;

-- +goose Down
alter table users
    drop column accent_palette,
    drop column color_scheme;
