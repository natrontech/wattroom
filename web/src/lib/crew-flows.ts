import { goto } from '$app/navigation';
import { account } from '$lib/account.svelte';
import { confirm } from '$lib/confirm.svelte';
import {
	inviteLink,
	leaveCrew,
	setCrewRole,
	transferCrew,
	type CrewPerson,
} from '$lib/crew';
import {
	deleteChannel,
	deleteChannelWarning,
	deleteLabel,
	type ChannelKind,
} from '$lib/channels';
import { chosenCrew } from '$lib/nav/chosen-crew.svelte';
import { presence } from '$lib/presence.svelte';
import { channelConnection } from '$lib/channel/connection.svelte';
import type { CrewRef } from '$lib/crew-types';
import { shareLink } from '$lib/share';
import { toasts } from '$lib/toast.svelte';

/**
 * Leaving a crew, from wherever it is offered — the crew page (#1228) and the
 * crew row's menu (#1257) — so the two cannot drift: one confirm, then one
 * call takes the membership and every channel of the crew you were named
 * into, the live connection is dropped if it was to one of its voice
 * channels, and you land on Home. Resolves to whether it happened.
 *
 * A confirm, not an undo (errors.md): an undo could only rejoin the crew by
 * its code — the private channels you were named into stay gone, so it would
 * promise a restore it cannot perform (audit 2026-09-09).
 */
export async function leaveCrewFlow(
	crew: Pick<CrewRef, 'id' | 'name'>,
): Promise<boolean> {
	const standing = channelConnection.current?.address.crew === crew.id;
	// The server's word, off the crew list (#2079): the confirm names the
	// crew going before the button rather than it vanishing after.
	const lastOut =
		presence.crews.find((c) => c.id === crew.id)?.lastOut === true;
	const sure = await confirm({
		title: `Leave ${crew.name}?`,
		body: leaveBody(crew.name, lastOut),
		action: 'Leave the crew',
		cancel: 'Keep it',
	});
	if (!sure) return false;
	const res = await leaveCrew(crew.id);
	if (!res.ok) {
		toasts.push(res.error.message, { tone: 'error' });
		return false;
	}
	if (standing) channelConnection.leave();
	presence.reload();
	toasts.push(
		lastOut
			? `You left ${crew.name}, and it is gone.`
			: `You left ${crew.name}.`,
	);
	await goto('/home');
	return true;
}

/** What leaving takes, said before the button — and when the last one out
 *  of a crew with nothing left in it takes the crew (#2079, #2837), that. */
export const leaveBody = (name: string, lastOut = false): string =>
	lastOut
		? `You are the last one in ${name} besides its owner, and it has no channels left, so it goes when you leave. Its code will open nothing.`
		: `You leave ${name}. Its code gets you back in.`;

/**
 * Deleting a channel, from wherever it is offered — the crew's sidebar menu
 * and its Settings — as one flow, so the ask cannot drift between them: the
 * confirm names what goes, and the crew with it when the server says this is
 * the last channel of a crew nobody else is in (#1935, #2837); then the
 * delete. A crew that went takes the rider Home.
 *
 * A confirm, not an undo (errors.md): nothing brings a deleted channel back.
 * Resolves true when the channel went and its crew still stands — the
 * caller's own follow-up — and false otherwise.
 */
export async function deleteChannelFlow(
	channel: { id: string; name: string; kind: ChannelKind; private?: boolean },
	crewId: string,
): Promise<boolean> {
	const crew = presence.crews.find((c) => c.id === crewId);
	const crewGoes = crew?.goesWithChannel ? crew.name : undefined;
	const sure = await confirm({
		title: `Delete ${channel.name}?`,
		body: deleteChannelWarning(channel, crewGoes),
		action: deleteLabel(channel.kind),
		cancel: 'Keep it',
	});
	if (!sure) return false;
	const res = await deleteChannel(channel.id);
	if (!res.ok) {
		toasts.push(res.error.message, { tone: 'error' });
		return false;
	}
	if (!crewGoes) return true;
	presence.reload();
	toasts.push(`${crewGoes} went with its last channel.`);
	await goto('/home');
	return false;
}

/**
 * Handing the crew on (#1208, #2095), from wherever it is offered — the
 * crew's people list, and whatever offers it next — as one flow, so the ask
 * cannot drift between them: one confirm naming what the actor gives up,
 * then the transfer, then presence reloads because the actor's own role
 * changed under them. Resolves to whether it happened.
 *
 * A confirm, not an undo (errors.md): the cost is paid by another person the
 * moment it lands, and the actor has no way back — the new owner is the one
 * person they can no longer demote, remove or ban, so only the new owner can
 * hand it back.
 */
export async function handOverCrewFlow(
	crew: Pick<CrewRef, 'id' | 'name'>,
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
 * The one question a crew ban asks, wherever it is pressed — the Members
 * page, a text channel's line, a voice channel's tile (#2542) — so the
 * three cannot drift apart.
 */
export const banAsk = (name: string) => ({
	title: `Ban ${name} from the crew?`,
	body: `They cannot come back through the crew's code until you lift the ban.`,
	action: 'Ban',
	cancel: 'Keep it',
});

/**
 * Banning someone from the crew (#1150), from wherever it is offered — the
 * crew's people list and a text channel's line (#2530) — as one flow, so the
 * ask cannot drift between them. Resolves to whether it happened.
 *
 * A confirm, not an undo (#1674): lifting the ban restores plain membership
 * and nothing it took with it — the private channels they were named into
 * stay gone (ADR-0058).
 */
export async function banFromCrewFlow(
	crew: Pick<CrewRef, 'id'>,
	person: Pick<CrewPerson, 'id' | 'displayName'>,
): Promise<boolean> {
	const sure = await confirm(banAsk(person.displayName));
	if (!sure) return false;
	const res = await setCrewRole(crew.id, person.id, 'banned');
	if (!res.ok) {
		toasts.push(res.error.message, { tone: 'error' });
		return false;
	}
	toasts.push(`Banned ${person.displayName} from the crew.`);
	return true;
}

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
	crew: Pick<CrewRef, 'id' | 'name'>,
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
 * page, the crew row's menu and a voice channel's lounge (#1236, #1257) —
 * one way, one toast.
 *
 * `shareLink` is the one way (#973): a share sheet where there is a finger to
 * open it with, the clipboard everywhere else, and the link itself when the
 * clipboard is refused. `shareVerb` is what the five buttons label themselves
 * with, so none of them promises a copy and opens a sheet.
 */
export async function shareInviteLink(code: string): Promise<void> {
	await shareLink(inviteLink(code), 'Invite link copied.');
}
