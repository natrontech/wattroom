# 0060 — A status is a line the rider writes, and it goes where their name goes

- Status: accepted
- Date: 2026-09-24
- Answers: [#2694](https://github.com/natrontech/wattroom/issues/2694)
- Sits beside: [0012](0012-friends-presence.md) (presence, which the server
  derives) and [0013](0013-room-identity-and-moderation.md) (crew emoji, #2643)

## Context

Presence already says *where* a rider is: online, in voice, riding
(ADR-0012). It cannot say *why* the rider has been missing for a week, or
that they are riding outside until Sunday. Slack and Discord answer this with a
status the person writes, and riders asked for the same, including the crew
emoji that shipped the same day (#2643).

That raises two questions. Who sees a status, when every other personal
surface here is scoped deliberately? And what does a crew emoji mean in a
status, when a status is personal, a rider belongs to several crews, and a crew
emoji's picture is readable only by that crew's members?

## Decision

**One status per rider**: an optional emoji, up to 100 characters of text, and
an optional time when it clears (numbers in docs/SPEC.md). The rider always
writes it. The server never derives one from riding, because presence already
does that job, and a status that set itself would be presence under another
name.

**It goes where the rider's name goes**, and nowhere else: the rider's page,
the crew's member list and the voice channel's occupants, the friends panel,
and the author line of a chat message. Each of those surfaces
already decided who may see that rider's name. The status rides along, so it
cannot tell a viewer anything about who can see whom. The friends panel is the
one place that is narrower than the name: a friend request shows a name, but
only an accepted friend sees the status, because accepting is the opt-in
(ADR-0012). It is never a ride control, so it has no ride-sized target.

**Any crew emoji the rider can use, carried by its id.** When the rider sets
the status they must be a member of the emoji's crew. From then on, anyone
signed in may load that one picture from `GET /api/emoji/{id}` for as long as
somebody wears it in a status that has not cleared. The picture therefore
leaves its crew, which is accepted for three reasons: a member uploaded it for
the crew to use, the wearer chose to show it, and the crew's owner and admins
can still delete it. A deleted emoji drops out of every status at once, and the
status shows its `:name:` instead, which is how chat already shows a deleted
emoji.

**Clearing is a time, not a job.** The client works out when the status clears,
because only the client knows when the rider's "today" ends. The server stores
that time and hides a status once it has passed. Nothing sweeps expired
statuses away, so there is no timer to lose on a restart.

**It is the rider's own writing.** It travels with the export (ADR-0053) and
is removed with the account, because it lives on the rider's row.

## Consequences

- One status has to fit every crew, so a crew emoji shows for viewers outside
  its crew too. We rejected a status per crew (Slack's shape): it would mean
  setting it again in every crew, and a rider with three crews would end up
  with three stale statuses.
- **Ceiling:** a rider who leaves a crew keeps wearing its emoji until the
  status clears or the crew deletes the emoji. Checking membership on every
  image load would close that gap, at the price of a join on a read the
  browser otherwise caches for good. Add the check if a crew ever complains.
- The picker offers the emoji of the crew the sidebar is showing, or the
  rider's main crew when the sidebar is on You. To wear another crew's emoji,
  the rider opens the editor from that crew.
- In code this is the **status line** (`protocol.StatusLine`, `statusLine` on
  every payload). The word "status" was already taken twice: by presence
  (`$lib/status.ts`) and by a friendship's state.
