import { flushSync } from 'svelte';
import { api } from '$lib/api';
import type { MenuEntry } from '$lib/context-menu.svelte';
import type { LiveChannel, LiveOccupant } from '$lib/crews-live';
import { toasts } from '$lib/toast.svelte';
import ArrowRight from '@lucide/svelte/icons/arrow-right';
import {
	ARRIVAL_MS,
	arrived,
	occupantsWithMoves,
	type MoveInFlight,
} from './voice-move';

/**
 * What a drag carries. The drop reads it rather than the controller's own
 * state: a list redrawn mid-drag (somebody joined, a lobby ping) can drop
 * the dragged row, and the drop must still know who and from where.
 */
const CARRIES = 'application/x-wattroom-rider';

const RIDING = 'Riding — they can be moved once they stop pedalling';

/**
 * The crew's owner or an admin moves a rider between voice channels (#2730),
 * Discord's drag, with the name's menu as the way for touch and the keyboard
 * (ux.md). The name lands on drop and waits there for the rider (#2745);
 * a refusal, or a rider who never arrives, sends it back with the reason.
 * Call during a component's init.
 */
export function createVoiceMover(crew: {
	admin: () => boolean;
	voices: () => readonly LiveChannel[];
}) {
	let dragging = $state<{ rider: string; from: string } | null>(null);
	let dropOn = $state<string | null>(null);
	let moves = $state.raw<MoveInFlight[]>([]);
	let ghostOf = $state<LiveOccupant | null>(null);
	let ghost: HTMLElement | null = null;

	const flying = $derived(moves.filter((m) => !arrived(crew.voices(), m)));
	const shown = $derived(occupantsWithMoves(crew.voices(), flying));
	const inFlight = (rider: string) => flying.some((m) => m.rider.id === rider);

	function reset() {
		dragging = null;
		dropOn = null;
	}

	async function move(rider: LiveOccupant, from: string, to: LiveChannel) {
		if (from === to.id || inFlight(rider.id)) return;
		const flight: MoveInFlight = { rider, from, to: to.id };
		moves = [...moves.filter((m) => m.rider.id !== rider.id), flight];
		const res = await api(`/api/channels/${to.id}/move`, {
			method: 'POST',
			json: { rider: rider.id, from },
		});
		if (!res.ok) {
			moves = moves.filter((m) => m !== flight);
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		// ponytail: one timer per move, never cleared — a column that
		// unmounts meanwhile still owes the admin the "never arrived".
		setTimeout(() => {
			if (!moves.includes(flight)) return;
			moves = moves.filter((m) => m !== flight);
			if (!arrived(crew.voices(), flight))
				toasts.push(
					`${rider.name} hasn’t arrived in ${to.name}. Their app may be closed or asleep — ask them to click over.`,
					// Said ten seconds after the drop, when the admin may be looking
					// elsewhere: it stays up twice as long as a toast usually does.
					{ tone: 'error', seconds: 8 },
				);
		}, ARRIVAL_MS);
	}

	/** Where a rider is drawn right now, move in flight included. */
	function whereIs(rider: string): string | undefined {
		for (const [channel, list] of shown)
			if (list.some((o) => o.id === rider)) return channel;
	}

	return {
		/** Who a voice channel shows, landed moves included. */
		occupants: (c: LiveChannel) => shown.get(c.id) ?? [],
		get dragging() {
			return dragging;
		},
		get dropOn() {
			return dropOn;
		},
		get ghostOf() {
			return ghostOf;
		},
		/** Moved here and not yet arrived: drawn quieter until they are. */
		inFlight,
		/** Moved here in the last few seconds: the landing's flash. */
		landed: (c: LiveChannel, o: LiveOccupant) =>
			moves.some((m) => m.rider.id === o.id && m.to === c.id),

		/** The drag preview: laid out once, off screen, photographed per drag. */
		ghostHere: (node: HTMLElement) => {
			ghost = node;
			return () => {
				if (ghost === node) ghost = null;
			};
		},

		/** A name's drag source. Empty for anyone who cannot move it. */
		grab(c: LiveChannel, o: LiveOccupant) {
			if (!crew.admin() || crew.voices().length < 2) return {};
			if (o.riding) return { title: RIDING };
			if (inFlight(o.id)) return { title: `Moving ${o.name}…` };
			return {
				draggable: true,
				title: `drag onto another voice channel to move ${o.name}`,
				ondragstart: (e: DragEvent) => {
					const carry = e.dataTransfer;
					if (!carry) return;
					carry.effectAllowed = 'move';
					carry.setData(CARRIES, JSON.stringify({ rider: o.id, from: c.id }));
					carry.setData('text/plain', o.name);
					// The preview has to hold this rider before the browser takes
					// its picture, which is before the handler returns.
					flushSync(() => (ghostOf = o));
					if (ghost) carry.setDragImage(ghost, 14, 14);
					dragging = { rider: o.id, from: c.id };
				},
				ondragend: reset,
			};
		},

		/** A voice channel's row, as somewhere a name can be dropped. */
		target(c: LiveChannel) {
			const ours = (e: DragEvent) =>
				!!e.dataTransfer?.types.includes(CARRIES) && dragging?.from !== c.id;
			const over = (e: DragEvent) => {
				if (!ours(e)) return;
				e.preventDefault();
				e.dataTransfer!.dropEffect = 'move';
				dropOn = c.id;
			};
			return {
				'data-voice-drop': c.id,
				ondragenter: over,
				ondragover: over,
				ondrop: (e: DragEvent) => {
					const carried = e.dataTransfer?.getData(CARRIES);
					const name = e.dataTransfer?.getData('text/plain') || 'They';
					reset();
					if (!carried) return;
					e.preventDefault();
					let what: { rider?: string; from?: string };
					try {
						what = JSON.parse(carried);
					} catch {
						return;
					}
					if (!what.rider || !what.from || what.from === c.id) return;
					const rider = shown.get(what.from)?.find((o) => o.id === what.rider);
					if (!rider) {
						const from = crew.voices().find((v) => v.id === what.from);
						toasts.push(
							`${name} has already left ${from?.name ?? 'that channel'}.`,
							{
								tone: 'error',
							},
						);
						return;
					}
					void move(rider, what.from, c);
				},
			};
		},

		/**
		 * The window's half. A highlight is cleared by the pointer being over
		 * something that is not a channel — dragleave fires for every child it
		 * crosses and its relatedTarget is null in Safari, so it flickers. And
		 * a drag that ends anywhere leaves nothing lit.
		 */
		window: {
			ondragover: (e: DragEvent) => {
				if (
					dropOn &&
					!(e.target as Element | null)?.closest?.('[data-voice-drop]')
				)
					dropOn = null;
			},
			ondrop: reset,
			ondragend: reset,
		},

		/** The name's menu: the same move, one entry per other voice channel. */
		menu(c: LiveChannel, o: LiveOccupant): MenuEntry[] {
			if (!crew.admin()) return [];
			const busy = o.riding ? 'riding' : inFlight(o.id) ? 'moving' : undefined;
			const here = whereIs(o.id) ?? c.id;
			return crew
				.voices()
				.filter((v) => v.id !== here)
				.map((v) => ({
					label: `Move to ${v.name}`,
					icon: ArrowRight,
					disabled: !!busy,
					hint: busy,
					onSelect: () => void move(o, here, v),
				}));
		},
	};
}

export type VoiceMover = ReturnType<typeof createVoiceMover>;
