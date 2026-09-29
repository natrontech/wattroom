import type { LiveCrew } from '$lib/crews-live';
import { livePulse } from './crew-live.svelte';

/**
 * Everything the sidebar marks as waiting for you, as one number (#3008):
 * each crew's unread lines, as its pulse counts them; every conversation with
 * an unread dot; and the friend requests to answer. The Dock and taskbar
 * badge shows this and only this, so it can never say something the sidebar
 * does not — the issue's "not a second source of truth".
 */
export function sidebarUnread(
	crews: readonly LiveCrew[],
	heads: readonly { unread?: boolean }[],
	waiting: number,
): number {
	return (
		crews.reduce((sum, crew) => sum + livePulse(crew).unread, 0) +
		heads.filter((head) => head.unread).length +
		waiting
	);
}
