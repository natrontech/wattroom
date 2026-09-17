import { api } from '$lib/api';
import { toasts } from '$lib/toast.svelte';
import { friends, type Friend } from './friends.svelte';

/** Enough of a friend to act on: who, and what to call them in the toast. */
export type Person = Pick<Friend, 'id' | 'name'>;

/**
 * The four ways a friendship changes (ADR-0012), in one place: the friends
 * panel offers all four, the rider page offers the same person the same
 * answers (#2172), and a row's menu offers whichever fits its standing.
 *
 * Each resolves to the message to show when the server refused, or `null`
 * when it went through — the caller decides where a refusal belongs (a line
 * on the page, a toast from a menu), and the toast that carries the undo is
 * the same wherever the act was started from.
 *
 * Every one of these is silent and immediate on the other side, so the way
 * back is an undo toast rather than a confirm (errors.md). What the undo can
 * actually do differs: a dismissal is restorable, while anything that took a
 * friendship down can only ask again — acceptance needs the other rider a
 * second time, so the toast says so rather than implying it snaps back.
 */
async function change(
	path: string,
	method: 'POST' | 'DELETE',
	toast?: { message: string; undo?: () => void },
): Promise<string | null> {
	const res = await api(path, { method });
	if (!res.ok) return res.error.message;
	await friends.reload();
	if (toast) toasts.push(toast.message, { undo: toast.undo });
	return null;
}

export function acceptRequest(friend: Person): Promise<string | null> {
	return change(`/api/friends/${friend.id}/accept`, 'POST');
}

/** A dismissal tells the other rider, and sat one button from Accept (#1652). */
export function dismissRequest(friend: Person): Promise<string | null> {
	return change(`/api/friends/${friend.id}`, 'DELETE', {
		message: `Dismissed ${friend.name}'s request.`,
		undo: () => void change(`/api/friends/${friend.id}/restore`, 'POST'),
	});
}

/** Withdrawing your own ask used to happen in silence with no way back (#2008). */
export function withdrawRequest(friend: Person): Promise<string | null> {
	return change(`/api/friends/${friend.id}`, 'DELETE', {
		message: `Withdrew your request to ${friend.name}.`,
		undo: () => void askAgain(friend),
	});
}

export function removeFriend(friend: Person): Promise<string | null> {
	return change(`/api/friends/${friend.id}`, 'DELETE', {
		message: `Removed ${friend.name} as a friend.`,
		undo: () => void askAgain(friend),
	});
}

/** The undo for both of those: a fresh request, said as what it is. */
export async function askAgain(friend: Person): Promise<string | null> {
	const res = await api('/api/friends', {
		method: 'POST',
		json: { userId: friend.id },
	});
	if (!res.ok) {
		toasts.push(res.error.message, { tone: 'error' });
		return res.error.message;
	}
	toasts.push(`Sent ${friend.name} a new friend request.`);
	await friends.reload();
	return null;
}
