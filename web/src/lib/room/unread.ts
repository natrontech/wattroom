import type { ChatLine } from '$lib/protocol';

/**
 * What the people column shows where the chat log used to be (#504, mock A):
 * the last thing said and how much of it you have not seen. The room's own
 * unread count cannot answer this — standing in the room counts as reading it
 * (#468) — so "seen" here means the Chat place was open.
 */
export interface Missed {
	count: number;
	from: string;
	preview: string;
}

export function missedSince(
	messages: ChatLine[],
	since: number,
	meId: string | undefined,
): Missed | null {
	const mine = (line: ChatLine) => !!meId && line.fromId === meId;
	const missed = messages.filter((line) => line.at > since && !mine(line));
	const last = missed[missed.length - 1];
	if (!last) return null;
	return {
		count: missed.length,
		from: last.from,
		// An image-only line still says someone spoke; the pixels are the
		// place's job, not the bar's.
		preview: last.text || (last.imageId ? 'sent an image' : ''),
	};
}
