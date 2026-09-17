import { goto } from '$app/navigation';
import { account } from '$lib/account.svelte';
import { confirm } from '$lib/confirm.svelte';
import {
	inviteLink,
	leaveCrew,
	transferCrew,
	type CrewPerson,
} from '$lib/crew';
import { chosenCrew } from '$lib/nav/chosen-crew.svelte';
import { presence } from '$lib/presence.svelte';
import { roomConnection } from '$lib/room/connection.svelte';
import type { RoomCrew } from '$lib/room/room-data';
import { shareLink } from '$lib/share';
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
	// Whether the crew goes when you do is the server's answer (#2079), taken
	// from the crews list wherever the Leave was offered from: the crew page's
	// own payload carries a roster and no such flag, and both surfaces must
	// say the same thing.
	const lastOut = !!presence.crews.find((c) => c.id === crew.id)?.lastOut;
	const sure = await confirm({
		title: lastOut ? `Leave ${crew.name} and end it?` : `Leave ${crew.name}?`,
		body: leaveBody(
			crew.name,
			mine.length,
			mine.filter((r) => r.access === 'private').length,
			lastOut,
		),
		action: lastOut ? 'Leave and end it' : 'Leave the crew',
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

/**
 * What leaving takes, said before the button.
 *
 * `lastOut` is the server's (#2079): leaving a crew with no rooms and nobody
 * but its owner left in it deletes the crew, so the promise the other branches
 * make — the code gets you back in — is a lie there. `rooms` cannot stand in
 * for it: it counts the rooms YOU are in, so zero also means a crew whose
 * rooms you simply never joined, where the code does get you back.
 */
export function leaveBody(
	name: string,
	rooms: number,
	privateRooms: number,
	lastOut = false,
): string {
	if (lastOut)
		return (
			`You leave ${name}, and the crew goes with you: it has no rooms and ` +
			`nobody but its owner left in it. Its name, its logo and its invite ` +
			`code end here, and no code brings it back.`
		);
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
 * What the action is called, wherever it is offered (#2175): the crew page
 * said "Make main crew" and the switcher's menu "Make it my main crew" — one
 * act with two names, a column apart.
 */
export const MAIN_CREW_LABEL = 'Make it my main crew';

/** Why it is worth pressing — the same sentence on both surfaces. */
export const MAIN_CREW_HINT = 'the sidebar opens in this crew on every device';

/**
 * Naming the main crew (#2144), from wherever it is offered — the crew page
 * and the crew row's menu — with the one toast. The sidebar switches to it
 * here and now; every other device opens in it from its next load.
 */
export async function makeMainCrewFlow(
	crew: Pick<RoomCrew, 'id' | 'name'>,
): Promise<boolean> {
	const err = await account.setHomeCrew(crew.id);
	if (err) {
		toasts.push(err.message, { tone: 'error' });
		return false;
	}
	chosenCrew.set(crew.id);
	toasts.push(
		`${crew.name} is your main crew now — it opens first on every device.`,
	);
	return true;
}

/**
 * The invite link out of the app, from wherever it is offered — the crew
 * page, its settings, the crew row's menu, a room's Members place and its
 * lounge (#1236, #1257) — one way, one toast.
 *
 * `shareLink` is the one way (#973): a share sheet where there is a finger to
 * open it with, the clipboard everywhere else, and the link itself when the
 * clipboard is refused. `shareVerb` is what the five buttons label themselves
 * with, so none of them promises a copy and opens a sheet.
 */
export async function shareInviteLink(code: string): Promise<void> {
	await shareLink(inviteLink(code), 'Invite link copied.');
}
