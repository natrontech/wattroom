-- name: SendDm :one
-- The friendship row IS the permission (ADR-0012 amended): no accepted
-- friendship, no insert — the caller reads zero rows back and refuses.
insert into dm_messages (sender_id, recipient_id, text, image_id)
select $1, $2, $3, $4
where exists (
    select 1 from friendships f
    where f.status = 'accepted'
      and ((f.requester_id = $1 and f.addressee_id = $2)
        or (f.requester_id = $2 and f.addressee_id = $1))
)
-- An attached image must belong to THIS pair. Serving already scopes by pair,
-- so a foreign id could never be viewed — but referencing one would pin its
-- bytes past the sweep, which is how a client escapes the storage bound.
and ($4::uuid is null or exists (
    select 1 from dm_images i
    where i.id = $4
      and least(i.sender_id, i.recipient_id) = least($1::uuid, $2::uuid)
      and greatest(i.sender_id, i.recipient_id) = greatest($1::uuid, $2::uuid)
))
returning id, created_at;

-- name: SaveDmImage :one
-- Gated identically to SendDm (#285): an image is a message body, so it must
-- clear the same friendship bar before a single byte is stored.
insert into dm_images (sender_id, recipient_id, mime, bytes)
select $1, $2, $3, $4
where exists (
    select 1 from friendships f
    where f.status = 'accepted'
      and ((f.requester_id = $1 and f.addressee_id = $2)
        or (f.requester_id = $2 and f.addressee_id = $1))
)
returning id;

-- name: GetDmImage :one
-- The row's own pair is the permission: readable by its sender or recipient,
-- nobody else — no friendship re-check, an unfriending must not black out
-- pictures already delivered.
select mime, bytes from dm_images
where id = sqlc.arg(image_id)
  and (sender_id = sqlc.arg(viewer_id) or recipient_id = sqlc.arg(viewer_id));

-- name: PruneDmImages :exec
-- Swept with the pair's 500-message bound: an image outlives neither its
-- message nor a 15-minute grace for uploads still awaiting their send.
delete from dm_images i
where least(i.sender_id, i.recipient_id) = least($1::uuid, $2::uuid)
  and greatest(i.sender_id, i.recipient_id) = greatest($1::uuid, $2::uuid)
  and i.created_at < now() - interval '15 minutes'
  and not exists (
      select 1 from dm_messages m where m.image_id = i.id
  );

-- name: PruneDms :exec
-- The 500-message bound per pair, pruned on write like room chat.
delete from dm_messages dm
where least(dm.sender_id, dm.recipient_id) = least($1::uuid, $2::uuid)
  and greatest(dm.sender_id, dm.recipient_id) = greatest($1::uuid, $2::uuid)
  and dm.id not in (
    select keep.id from (
        select id from dm_messages
        where least(sender_id, recipient_id) = least($1::uuid, $2::uuid)
          and greatest(sender_id, recipient_id) = greatest($1::uuid, $2::uuid)
        order by created_at desc
        limit 500
    ) keep
);

-- name: ListDms :many
-- One pair's thread, oldest-first; `after` narrows a poll to the new tail.
select m.id, m.sender_id, m.text, m.image_id, m.created_at
from dm_messages m
where least(m.sender_id, m.recipient_id) = least($1::uuid, $2::uuid)
  and greatest(m.sender_id, m.recipient_id) = greatest($1::uuid, $2::uuid)
  and m.created_at > $3
order by m.created_at
limit 200;

-- name: ListDmHeads :many
-- The conversation list: my peers with their latest line, newest first.
select distinct on (peer.id)
    peer.id as peer_id, peer.display_name, peer.avatar_url, peer.avatar_preset,
    user_total_xp(peer.id)::bigint as total_xp,
    m.text, m.image_id, m.sender_id, m.created_at
from dm_messages m
join users peer
  on peer.id = case when m.sender_id = $1 then m.recipient_id else m.sender_id end
where m.sender_id = $1 or m.recipient_id = $1
order by peer.id, m.created_at desc;
