/**
 * The microphone, as an object (#914). Same rule as the rest of the mix
 * (#874): what belongs to one thing lives on that thing. How you transmit —
 * voice activation or push-to-talk — is a property of your mic, and it was
 * two buttons inside the Sound modal, three clicks from the mic that is
 * pinned in front of you.
 *
 * The gate THRESHOLD is not here on purpose. Its slider is its meter
 * (`GateMeter`, #289): you set it by dragging the mark under your own live
 * level, and a closed gate looks exactly like a dead mic without one. A
 * number in a menu would not be settable, so the menu opens the surface that
 * has the meter instead.
 */
import { Mic, MicOff, Radio, SlidersHorizontal } from '@lucide/svelte';
import type { MenuEntry } from '$lib/context-menu.svelte';
import { openSoundPanel } from '$lib/room/sound-panel.svelte';

export interface MicVoice {
	micOn: boolean;
	mode: 'gate' | 'ptt';
	setMode: (mode: 'gate' | 'ptt') => void;
}

export function micMenu(voice: MicVoice, onMic: () => void): MenuEntry[] {
	const mode = (
		id: 'gate' | 'ptt',
		label: string,
		icon: typeof Radio,
	): MenuEntry => ({
		label,
		icon,
		// The current one is marked, not disabled: a menu that greys out where
		// you already are makes you check twice which one that was.
		hint: voice.mode === id ? 'on' : undefined,
		onSelect: () => voice.setMode(id),
	});
	return [
		{
			label: voice.micOn ? 'Mute' : 'Unmute',
			icon: voice.micOn ? MicOff : Mic,
			onSelect: onMic,
		},
		'separator',
		mode('gate', 'Voice activation', Radio),
		mode('ptt', 'Push to talk', Mic),
		'separator',
		{
			label: 'Tune your gate…',
			icon: SlidersHorizontal,
			onSelect: openSoundPanel,
		},
	];
}
