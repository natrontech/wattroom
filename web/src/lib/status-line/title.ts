import type { StatusLine } from '$lib/protocol';

/**
 * A name as a notification's title says it (#2744): with the rider's status
 * emoji after it, as Slack does — "Sven 🏔️". A Unicode emoji only: an OS
 * notification cannot draw a crew emoji's picture, and its `:name:` would be
 * noise. The words stay off, where they would crowd the message itself.
 */
export function titleWithStatus(
	name: string,
	line: StatusLine | null | undefined,
	now = Date.now(),
): string {
	const emoji = line?.emoji;
	if (!emoji || emoji.startsWith(':')) return name;
	if (line.expiresAt && Date.parse(line.expiresAt) <= now) return name;
	return `${name} ${emoji}`;
}
