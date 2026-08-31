-- name: SendDm :one
-- The friendship row IS the permission (ADR-0012 amended): no accepted
-- friendship, no insert — the caller reads zero rows back and refuses.
insert into dm_messages (sender_id, recipient_id, text)
select $1, $2, $3
where exists (
    select 1 from friendships f
    where f.status = 'accepted'
      and ((f.requester_id = $1 and f.addressee_id = $2)
        or (f.requester_id = $2 and f.addressee_id = $1))
)
returning id, created_at;

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
select m.id, m.sender_id, m.text, m.created_at
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
    (select coalesce(sum(xp), 0) from rides r where r.user_id = peer.id)::bigint as total_xp,
    m.text, m.sender_id, m.created_at
from dm_messages m
join users peer
  on peer.id = case when m.sender_id = $1 then m.recipient_id else m.sender_id end
where m.sender_id = $1 or m.recipient_id = $1
order by peer.id, m.created_at desc;
