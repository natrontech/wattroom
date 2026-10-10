/**
 * One mark for "there is something new", wherever it appears (#568): a count
 * where the server counts (a text channel), a dot where it only knows that
 * something is (a DM). Both sit on the muted surface — an unread mark is
 * chrome, and ADR-0005 gives the glow to live data alone. The sidebar's DM dot
 * used to take `--color-watt` and was the loudest thing on a quiet screen.
 * A count on a riding surface is read at SPEC's 24 px (G4, #3770).
 */
export const UNREAD_COUNT =
	'bg-muted/25 text-ink shrink-0 rounded-full px-1.5 text-[10px] font-bold tabular-nums cave:px-2 cave:text-2xl';

export const UNREAD_DOT = 'bg-muted/60 h-2 w-2 shrink-0 rounded-full';

/** Past 99 the number stops being information. */
export function unreadCount(n: number): string {
	return n > 99 ? '99+' : String(n);
}
