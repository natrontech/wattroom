import type { DmHead } from '$lib/dm/heads.svelte';
import { headPreview } from '$lib/dm/heads.svelte';
import type { RailRoom } from '$lib/room/mockcompat';

/**
 * The messages list (#468): every room's chat and every DM, one list, one
 * line each. Unread first, then whoever spoke last — a room is a thread
 * like any other here, so it sorts by its last line, not by its name.
 */
export type Thread =
	| {
			kind: 'room';
			key: string;
			href: string;
			name: string;
			icon?: string;
			unread: number;
			at: number;
			preview: string;
			here: number;
			voice: number;
			riding: boolean;
	  }
	| {
			kind: 'dm';
			key: string;
			href: string;
			name: string;
			unread: number;
			at: number;
			preview: string;
			head: DmHead;
	  };

export function roomThread(room: RailRoom): Thread {
	const last = room.lastChat;
	return {
		kind: 'room',
		key: `r:${room.slug}`,
		href: `/messages/r/${room.slug}`,
		name: room.name,
		icon: room.icon,
		unread: room.unread ?? 0,
		at: last?.at ?? 0,
		preview: last
			? `${last.from}: ${last.text || (last.hasImage ? 'sent an image' : '')}`
			: '',
		here: room.connected ?? 0,
		voice: room.voice?.length ?? 0,
		riding: (room.riding?.length ?? 0) > 0,
	};
}

export function dmThread(head: DmHead, unread: boolean): Thread {
	return {
		kind: 'dm',
		key: `dm:${head.peerId}`,
		href: `/messages/dm/${head.peerId}`,
		name: head.peerName,
		unread: unread ? 1 : 0,
		at: head.at,
		preview: `${head.mine ? 'you' : head.peerName}: ${headPreview(head)}`,
		head,
	};
}

/** Unread on top, then most recent first; the never-spoken-in sort last, by name. */
export function orderThreads(
	rooms: RailRoom[],
	heads: DmHead[],
	dmUnread: (peerId: string) => boolean,
): Thread[] {
	return [
		...rooms.map(roomThread),
		...heads.map((head) => dmThread(head, dmUnread(head.peerId))),
	].sort(
		(a, b) =>
			Number(b.unread > 0) - Number(a.unread > 0) ||
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
