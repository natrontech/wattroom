-- +goose Up
-- Autoplay's third mode (#269): 'smart' draws from the music pool weighted by
-- the room's play/skip history, where 'ordered' and 'shuffled' walk the
-- active playlist. 00028 pinned the column to the two that existed then.
--
-- Expand/contract (ADR-0019): this only WIDENS what the column accepts, so
-- the release before it keeps writing 'ordered'/'shuffled' against the new
-- constraint unchanged. Rolling back to that image leaves any room already
-- set to 'smart' reading as a playlist room — the old Autoplay() falls
-- through to the active playlist in list order — rather than failing.
alter table rooms drop constraint if exists rooms_autoplay_order_check;
alter table rooms add constraint rooms_autoplay_order_check
    check (autoplay_order in ('ordered', 'shuffled', 'smart'));

-- +goose Down
-- Narrowing again would reject rows this release legitimately wrote, so put
-- them back on the playlist first: 'ordered' is what a smart room degrades to
-- with the pool no longer reachable.
update rooms set autoplay_order = 'ordered' where autoplay_order = 'smart';
alter table rooms drop constraint if exists rooms_autoplay_order_check;
alter table rooms add constraint rooms_autoplay_order_check
    check (autoplay_order in ('ordered', 'shuffled'));
