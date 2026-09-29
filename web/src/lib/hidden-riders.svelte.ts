/**
 * Hide this rider (#3202, ADR-0012 amended 2026-09-29): a block that works
 * both ways. The server does the hiding — DMs, friend requests, cheers,
 * pokes and reactions stop crossing between the two — and the rider who was
 * hidden is never told. This is the rider's own list, the two verbs, and the
 * one sentence every surface says about what hiding does not do.
 *
 * Reversible, so it runs at once with an undo (errors.md): nothing between
 * the two riders is deleted, and showing them again puts it all back.
 */
import { api } from '$lib/api';
import { dmHeads } from '$lib/dm/heads.svelte';
import { friends } from '$lib/friends/friends.svelte';
import { cachedRider } from '$lib/rider-card/cache';
import { fetchRider } from '$lib/rider';
import { toasts } from '$lib/toast.svelte';

export interface HiddenRider {
	id: string;
	name: string;
	avatarUrl?: string;
	/** When they were hidden, unix ms. */
	since: number;
}

/** Hiding never parts a crew: sessions, voice and live numbers stay shared. */
export function stillTogether(crew: string): string {
	return `You still ride together in ${crew}. An admin can remove a member.`;
}

let list = $state<HiddenRider[] | null>(null);
let error = $state<string | null>(null);
let asked = false;

async function load(): Promise<void> {
	asked = true;
	const res = await api<{ riders: HiddenRider[] }>('/api/blocks');
	if (res.ok) {
		list = res.data.riders;
		error = null;
	} else error = res.error.message;
}

/** Friends and threads change on both sides; neither waits for its poll. */
function settle() {
	void friends.reload();
	dmHeads.refresh();
	void load();
}

/**
 * Their page read again, so a card open on them turns with the change — and
 * the crew the two share, which the toast has to name.
 */
async function reread(id: string): Promise<string | undefined> {
	const res = await fetchRider(id);
	if (!res.ok) return undefined;
	cachedRider(id, res.data);
	return res.data.crewsInCommon[0]?.name;
}

async function hide(id: string, name: string, quiet = false): Promise<boolean> {
	const res = await api('/api/blocks', {
		method: 'POST',
		json: { userId: id },
	});
	if (!res.ok) {
		toasts.push(res.error.message, { tone: 'error' });
		return false;
	}
	settle();
	const crew = await reread(id);
	if (!quiet)
		toasts.push(
			crew ? `${name} is hidden. ${stillTogether(crew)}` : `${name} is hidden.`,
			{ undo: () => void show(id, name, true) },
		);
	return true;
}

async function show(id: string, name: string, quiet = false): Promise<boolean> {
	const res = await api(`/api/blocks/${id}`, { method: 'DELETE' });
	if (!res.ok) {
		toasts.push(res.error.message, { tone: 'error' });
		return false;
	}
	settle();
	await reread(id);
	if (!quiet)
		toasts.push(`${name} can reach you again.`, {
			undo: () => void hide(id, name, true),
		});
	return true;
}

export const hiddenRiders = {
	/** Null until the first answer — a loading line, never an empty list. */
	get list() {
		return list;
	},
	get error() {
		return error;
	},
	load,
	/** Whether you hid them, as far as the list knows; asks for it once. */
	has(id: string): boolean {
		if (!asked) void load();
		return list?.some((r) => r.id === id) ?? false;
	},
	hide: (id: string, name: string) => hide(id, name),
	show: (id: string, name: string) => show(id, name),
};
