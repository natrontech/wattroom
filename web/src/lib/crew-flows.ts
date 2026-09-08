import { goto } from '$app/navigation';
import { joinCrew, leaveCrew } from '$lib/crew';
import { presence } from '$lib/presence.svelte';
import { roomConnection } from '$lib/room/connection.svelte';
import type { RoomCrew } from '$lib/room/room-data';
import { toasts } from '$lib/toast.svelte';

/**
 * Leaving a crew, from wherever it is offered — the crew page (#1228) and the
 * crew row's menu (#1257) — so the two cannot drift: one call takes the
 * membership and every room of the crew you were in, the live connection is
 * dropped if it was to one of those rooms, the undo rejoins by the code the
 * client still holds, and you land on Home. Resolves to whether it happened.
 */
export async function leaveCrewFlow(
	crew: Pick<RoomCrew, 'id' | 'name' | 'code'>,
): Promise<boolean> {
	const standing = presence.rooms.some(
		(r) => r.crew?.id === crew.id && r.slug === roomConnection.current?.slug,
	);
	const res = await leaveCrew(crew.id);
	if (!res.ok) {
		toasts.push(res.error.message, { tone: 'error' });
		return false;
	}
	if (standing) roomConnection.leave();
	presence.reload();
	const code = crew.code;
	toasts.push(`You left ${crew.name}.`, {
		undo: code
			? () => void joinCrew(code).then(() => presence.reload())
			: undefined,
	});
	await goto('/home');
	return true;
}
