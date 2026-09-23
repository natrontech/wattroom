import { api } from '$lib/api';
import { toasts } from '$lib/toast.svelte';

/**
 * Takes a text channel's announcement down — from the channel itself, the
 * crew's Board or a voice channel's Lounge strip (ADR-0058 on 0057). Undo,
 * not a confirm (errors.md): the line is still in its channel and can be
 * marked again, which is what Undo does. `settle` re-reads what the caller
 * shows, after the take-down and after an Undo. False when it was refused.
 */
export async function takeDownAnnouncement(
	channelId: string,
	messageId: string | undefined,
	settle: () => unknown,
): Promise<boolean> {
	const at = `/api/channels/${channelId}/announcement`;
	const res = await api(at, { method: 'DELETE' });
	if (!res.ok) {
		toasts.push(res.error.message, { tone: 'error' });
		return false;
	}
	void settle();
	toasts.push('Announcement taken down.', {
		undo: messageId
			? async () => {
					const back = await api(at, { method: 'PUT', json: { messageId } });
					if (back.ok) void settle();
					else toasts.push(back.error.message, { tone: 'error' });
				}
			: undefined,
	});
	return true;
}
