/**
 * A poke (#707, #2721): one rider asking another for attention.
 *
 * Between friends it is a line in their DM thread — who and when, and the
 * words if any were sent — which the hub also taps live into whichever
 * channel the friend is in. Anyone else can only be poked across the voice
 * channel you share, and that one leaves no record.
 *
 * Both paths reach the receiver as the same arrival, keyed by the poker and
 * the moment, so a friend's poke heard on the socket and then found by the
 * thread's poll is announced once.
 */
import { api } from '$lib/api';
import type { Arrival } from '$lib/messages/announce';
import type { ReplyTo } from '$lib/notify.svelte';
import type { Poke } from '$lib/protocol';
import { toasts } from '$lib/toast.svelte';

/** A friend's DM thread, where their pokes live. */
export const threadOf = (id: string) => `/messages/dm/${id}`;

/** Answer a DM from the notification itself, where the shell offers a field. */
export function dmReply(peerId: string, name: string): ReplyTo {
	return {
		placeholder: `Reply to ${name}`,
		send: async (text) => {
			const res = await api(`/api/dms/${peerId}`, {
				method: 'POST',
				json: { text },
			});
			return res.ok ? null : res.error.message;
		},
	};
}

/** Write a poke into a friend's thread; the refusal, or null once it landed. */
export async function sendPoke(id: string, text = ''): Promise<string | null> {
	const res = await api(`/api/dms/${id}/poke`, {
		method: 'POST',
		json: { text },
	});
	return res.ok ? null : res.error.message;
}

/** Poke a friend from anywhere, and say how it went. */
export async function pokeFriend(id: string, name: string): Promise<void> {
	const refusal = await sendPoke(id);
	if (refusal) toasts.push(refusal, { tone: 'error' });
	else toasts.push(`Poked ${name}.`, { href: threadOf(id) });
}

/**
 * A poke that reached this rider, from the channel's socket or a DM thread's
 * poll. `channel` is where a socket poke was heard, for one that is not a
 * DM line; `pokeBack` is how to answer it, which the caller knows.
 */
export function pokeArrival(
	poke: Pick<Poke, 'text' | 'dm'> & {
		fromId: string;
		from: string;
		at: number;
	},
	pokeBack: () => void,
	channel?: { name: string; href: string },
): Arrival {
	const inChannel = !poke.dm && channel;
	return {
		kind: 'poke',
		tag: `poke-${poke.fromId}`,
		at: poke.at,
		title: inChannel
			? `${poke.from} poked you in ${channel.name}`
			: `${poke.from} poked you`,
		body: poke.text ?? '',
		href: inChannel ? channel.href : threadOf(poke.fromId),
		// A poke asks for attention even with the thread open: the line there
		// arrives on the next poll, the cue now.
		reading: false,
		reply: poke.dm ? dmReply(poke.fromId, poke.from) : undefined,
		action: { label: 'Poke back', run: pokeBack },
		from: poke.from,
	};
}
