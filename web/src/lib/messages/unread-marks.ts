/**
 * One mark for "there is something new", wherever it appears (#568): a count
 * where the server counts (a room), a dot where it only knows that something
 * is (a DM). Both sit on the muted surface — an unread mark is chrome, and
 * ADR-0005 gives the glow to live data alone. The sidebar's DM dot used to
 * take `--color-watt` and was the loudest thing on a quiet screen.
 */
export const UNREAD_COUNT =
	'bg-muted/25 text-ink shrink-0 rounded-full px-1.5 text-[10px] font-bold tabular-nums';

export const UNREAD_DOT = 'bg-muted/60 h-2 w-2 shrink-0 rounded-full';

/** Past 99 the number stops being information. */
export function unreadCount(n: number): string {
	return n > 99 ? '99+' : String(n);
}
