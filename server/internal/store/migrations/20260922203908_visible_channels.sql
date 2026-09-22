-- +goose Up
-- Who may enter which channel, as one relation (ADR-0058, #2465): the
-- successor of `visible_rooms`, and the same argument for being a view —
-- every SQL visibility join asks it, so none of them writes the guard out by
-- hand and gets it wrong (#1109, #1114).
--
-- It is `mayEnter` in server/internal/channels/access.go, word for word: the
-- crew's owner (who cannot be banned) and its admins enter every channel; a
-- member enters an open channel, and a private one only when named into it; a
-- banned rider, and anyone the crew has never heard of, enters none. A crew
-- ban needs no clause of its own — a banned row is neither admin nor member.
--
-- Who may see, hear and find whom follows the channels two riders may BOTH
-- enter. On migration day that is the rooms-in-common set exactly, because
-- every channel inherited its room's gate (#2428). `visible_rooms` stays until
-- the rooms tables go (#2433).
create view visible_channels as
select c.id as channel_id, cw.owner_id as user_id
from channels c
join crews cw on cw.id = c.crew_id
union
select c.id, cr.user_id
from channels c
join crew_roles cr on cr.crew_id = c.crew_id
where cr.role = 'admin'
   or (cr.role = 'member'
       and (not c.private
            or exists (select 1 from channel_members cm
                       where cm.channel_id = c.id and cm.user_id = cr.user_id)));

-- +goose Down
drop view visible_channels;
