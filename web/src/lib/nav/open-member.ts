/**
 * A name in the rail is only a name — `RailRoom.riders` carries display names,
 * not ids — so reaching the rider behind one costs a member-gated lookup:
 * `/api/rooms/{slug}` answers with the room's members and their page takes the
 * id from there.
 *
 * It lands on `/u/<id>` rather than reopening #207's popout (#540). The card
 * summarised role, FTP, w/kg, joined-at and medals; `/r/<slug>/members` now
 * shows all of that per rider, and #533 moved the card's one action out to
 * `personMenu` and the rider's page. There is nothing left for a modal to say
 * that the page it would cover does not say better.
 */
import { api } from '$lib/api';
import { toasts } from '$lib/toast.svelte';

interface RoomMembers {
	members?: { id: string; displayName: string }[];
}

export async function openMember(
	slug: string,
	name: string,
	go: (href: string) => void,
): Promise<void> {
	const res = await api<RoomMembers>(`/api/rooms/${slug}`);
	if (!res.ok) {
		toasts.push(res.error.message, { tone: 'error' });
		return;
	}
	const member = res.data.members?.find((m) => m.displayName === name);
	if (!member) {
		// The rail's names come from presence, which can be a tick ahead of the
		// member list — someone who just left is the ordinary way here.
		toasts.push(`${name} is not a member of this room.`, { tone: 'error' });
		return;
	}
	go(`/u/${member.id}`);
}
