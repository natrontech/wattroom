import type { DmHead } from '$lib/dm/heads.svelte';
import { headPreview } from '$lib/dm/heads.svelte';

/**
 * The messages list (#468): every direct message, one line each. Unread
 * first, then whoever spoke last. A crew talks in its text channels, which
 * live in the crew's column (ADR-0058), not here.
 */
export interface Thread {
	key: string;
	href: string;
	name: string;
	/** A DM knows only that something is new, not how much. */
	unread: boolean;
	at: number;
	preview: string;
	head: DmHead;
}

function dmThread(head: DmHead, unread: boolean): Thread {
	return {
		key: `dm:${head.peerId}`,
		href: `/messages/dm/${head.peerId}`,
		name: head.peerName,
		unread,
		at: head.at,
		preview: `${head.mine ? 'you' : head.peerName}: ${headPreview(head)}`,
		head,
	};
}

/** Unread on top, then most recent first; the never-spoken-in sort last, by name. */
export function orderThreads(
	heads: DmHead[],
	unread: (peerId: string) => boolean,
): Thread[] {
	return heads
		.map((head) => dmThread(head, unread(head.peerId)))
		.sort(
			(a, b) =>
				Number(b.unread) - Number(a.unread) ||
				b.at - a.at ||
				a.name.localeCompare(b.name),
		);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a thread last moved, as a messenger says it: the time today, the
 * weekday inside a week, the date beyond. Nothing for a thread that never
 * moved.
 */
export function formatThreadWhen(at: number, now = Date.now()): string {
	if (!at) return '';
	const then = new Date(at);
	const today = new Date(now);
	const sameDay =
		then.getFullYear() === today.getFullYear() &&
		then.getMonth() === today.getMonth() &&
		then.getDate() === today.getDate();
	if (sameDay)
		return then.toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
		});
	if (now - at < 7 * DAY_MS)
		return then.toLocaleDateString(undefined, { weekday: 'short' });
	return then.toLocaleDateString(undefined, {
		day: '2-digit',
		month: '2-digit',
	});
}
