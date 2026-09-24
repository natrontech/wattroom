/**
 * When a status line clears (ADR-0060, docs/SPEC.md "Personal status"):
 * Slack's presets, worked out here because only the browser knows where the
 * rider's "today" ends. The server stores the instant and hides it after.
 */
export type ClearAfter = 'never' | '30m' | '1h' | '4h' | 'today' | 'week';

export const CLEAR_AFTER: readonly { key: ClearAfter; label: string }[] = [
	{ key: 'never', label: "Don't clear" },
	{ key: '30m', label: '30 minutes' },
	{ key: '1h', label: '1 hour' },
	{ key: '4h', label: '4 hours' },
	{ key: 'today', label: 'Today' },
	{ key: 'week', label: 'This week' },
];

/** The instant `key` clears at, ISO 8601 — or '' for "don't clear". */
export function clearsAt(key: ClearAfter, now = new Date()): string {
	const at = new Date(now);
	switch (key) {
		case 'never':
			return '';
		case '30m':
			at.setMinutes(at.getMinutes() + 30);
			break;
		case '1h':
			at.setHours(at.getHours() + 1);
			break;
		case '4h':
			at.setHours(at.getHours() + 4);
			break;
		case 'today':
			// The next local midnight.
			at.setHours(24, 0, 0, 0);
			break;
		case 'week':
			// The midnight that ends the local Sunday.
			at.setHours(24, 0, 0, 0);
			at.setDate(at.getDate() + ((8 - at.getDay()) % 7));
			break;
	}
	return at.toISOString();
}

/** "clears 18:30", "clears Sun 00:00" — for the rider's own editor. */
export function clearsLabel(
	expiresAt: string | undefined,
	now = new Date(),
): string {
	if (!expiresAt) return '';
	const at = new Date(expiresAt);
	const sameDay = at.toDateString() === now.toDateString();
	return `clears ${at.toLocaleString([], {
		...(sameDay ? {} : { weekday: 'short' }),
		hour: '2-digit',
		minute: '2-digit',
	})}`;
}
