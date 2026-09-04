import { notify } from '$lib/notify.svelte';
import { shouldAnnounce } from '$lib/notify-once';
import type { Poke } from '$lib/protocol';
import { play } from '$lib/sound/cues';

/** Announce one authenticated poke once per device, however many tabs heard it. */
export function announcePoke(
	poke: Poke | null | undefined,
	slug: string,
	roomName: string,
): void {
	if (!poke?.fromId || !poke.from || !poke.at) return;
	const tag = `poke-${slug}-${poke.fromId}`;
	if (!shouldAnnounce(tag, poke.at)) return;
	// play() owns the receiver's cue fader; notify.push() owns both browser
	// permission and the hidden-tab gate. A poke bypasses neither.
	play('poke');
	notify.push(poke.from, `Poked you in ${roomName}`, tag);
}
