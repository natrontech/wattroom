import { goto } from '$app/navigation';
import { confirm } from '$lib/confirm.svelte';
import {
	inviteLink,
	leaveCrew,
	transferCrew,
	type CrewPerson,
} from '$lib/crew';
import { presence } from '$lib/presence.svelte';
import { roomConnection } from '$lib/room/connection.svelte';
import type { RoomCrew } from '$lib/room/room-data';
import { toasts } from '$lib/toast.svelte';

/**
 * Leaving a crew, from wherever it is offered — the crew page (#1228) and the
 * crew row's menu (#1257) — so the two cannot drift: one confirm naming what
 * goes, then one call takes the membership and every room of the crew you
 * were in, the live connection is dropped if it was to one of those rooms,
 * and you land on Home. Resolves to whether it happened.
 *
 * A confirm, not an undo (errors.md): the undo rejoined the crew by its code
 * and nothing else — every room membership, a coach role, a private room's
 * grant stayed gone, so the toast promised a restore it could not perform
 * (audit 2026-09-09).
 */
export async function leaveCrewFlow(
	crew: Pick<RoomCrew, 'id' | 'name'>,
): Promise<boolean> {
	const mine = presence.rooms.filter((r) => r.crew?.id === crew.id && !!r.role);
	const standing = mine.some((r) => r.slug === roomConnection.current?.slug);
	const sure = await confirm({
		title: `Leave ${crew.name}?`,
		body: leaveBody(
			crew.name,
			mine.length,
			mine.filter((r) => r.access === 'private').length,
		),
		action: 'Leave the crew',
		cancel: 'Keep it',
	});
	if (!sure) return false;
	const res = await leaveCrew(crew.id);
	if (!res.ok) {
		toasts.push(res.error.message, { tone: 'error' });
		return false;
	}
	if (standing) roomConnection.leave();
	presence.reload();
	toasts.push(`You left ${crew.name}.`);
	await goto('/home');
	return true;
}

/** What leaving takes, said before the button. */
export function leaveBody(
	name: string,
	rooms: number,
	privateRooms: number,
): string {
	if (rooms === 0) return `You leave ${name}. Its code gets you back in.`;
	const which = rooms === 1 ? 'the room' : `the ${rooms} rooms`;
	const back =
		privateRooms > 0
			? 'Its code gets you back into the crew; a private room needs a fresh invitation from its owner.'
			: 'Its code gets you back into the crew, and its open rooms are yours to walk into again.';
	return `You leave ${name} and ${which} of it you are in. ${back}`;
}

/**
 * Handing the crew on (#1208, #2095), from wherever it is offered — the
 * crew's people list, and whatever offers it next — so the ask cannot drift
 * from the room hand-over it mirrors: one confirm naming what the actor
 * gives up, then the transfer, then presence reloads because the actor's own
 * role changed under them. Resolves to whether it happened.
 *
 * A confirm, not an undo (errors.md): the cost is paid by another person the
 * moment it lands, and the actor has no way back — the new owner is the one
 * person they can no longer demote, remove or ban, so only the new owner can
 * hand it back.
 */
export async function handOverCrewFlow(
	crew: Pick<RoomCrew, 'id' | 'name'>,
	to: Pick<CrewPerson, 'id' | 'displayName'>,
): Promise<boolean> {
	const sure = await confirm({
		title: `Hand ${crew.name} to ${to.displayName}?`,
		body: HAND_OVER_BODY,
		action: 'Hand it over',
		cancel: 'Keep it',
	});
	if (!sure) return false;
	const res = await transferCrew(crew.id, to.id);
	if (!res.ok) {
		toasts.push(res.error.message, { tone: 'error' });
		return false;
	}
	toasts.push(`${to.displayName} owns ${crew.name} now. You are an admin.`);
	presence.reload();
	return true;
}

/**
 * What handing it on costs, said before the button. The two halves errors.md
 * asks for: what happens to them, and what breaks for you.
 */
export const HAND_OVER_BODY =
	'They become its owner — the one person you can no longer demote, remove ' +
	'or ban — and you drop to admin, which keeps everything but handing the ' +
	'crew on. You cannot take this back; only they can hand it back to you.';

/**
 * The invite link onto the clipboard, from wherever it is offered — the crew
 * page, its settings, the crew row's menu (#1236, #1257) — with the one toast.
 */
export async function copyInviteLink(code: string): Promise<void> {
	const link = inviteLink(code);
	try {
		await navigator.clipboard.writeText(link);
	} catch {
		// A clipboard the browser refused (no permission, no focus) is not a
		// dead end: the link itself is the feedback (errors.md).
		toasts.push(`Could not copy — the link is ${link}`, {
			tone: 'error',
			seconds: 12,
		});
		return;
	}
	toasts.push('Invite link copied.');
}
