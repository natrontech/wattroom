/**
 * The microphone, as an object (#914). Same rule as the rest of the mix
 * (#874): what belongs to one thing lives on that thing. How you transmit —
 * voice activation or push-to-talk — is a property of your mic, and it was
 * two buttons inside the Sound modal, three clicks from the mic that is
 * pinned in front of you.
 *
 * Which microphone you speak through is the same kind of thing (#920): a
 * choice, on the object it belongs to. The list comes from `deviceOptions`,
 * so the menu and the panel cannot disagree about what an unnamed device is
 * called. No refresh call is needed — `av` re-reads devices on a
 * `devicechange` and when the permission grant makes labels readable (#658),
 * and this menu only exists once you are in voice.
 *
 * The gate THRESHOLD is not here on purpose. Its slider is its meter
 * (`GateMeter`, #289): you set it by dragging the mark under your own live
 * level, and a closed gate looks exactly like a dead mic without one. A
 * number in a menu would not be settable, so the menu opens the surface that
 * has the meter instead.
 */
import Mic from '@lucide/svelte/icons/mic';
import MicOff from '@lucide/svelte/icons/mic-off';
import Radio from '@lucide/svelte/icons/radio';
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
import type { MenuEntry } from '$lib/context-menu.svelte';
import { type Device, deviceOptions } from '$lib/room/device-options';
import { openSoundPanel } from '$lib/room/sound-panel.svelte';
import { canHoldToTalk } from '$lib/room/ptt-keys';

export interface MicVoice {
	micOn: boolean;
	mode: 'gate' | 'ptt';
	setMode: (mode: 'gate' | 'ptt') => void;
	mics: Device[];
	micId: string;
	setMic: (id: string) => void | Promise<void>;
}

export function micMenu(voice: MicVoice, onMic: () => void): MenuEntry[] {
	// One entry is the system default alone: nothing to choose between.
	const inputs = deviceOptions(voice.mics, 'Microphone');
	const mode = (
		id: 'gate' | 'ptt',
		label: string,
		icon: typeof Radio,
		hint?: string,
	): MenuEntry => ({
		label,
		icon,
		// The current one is marked, not disabled: a menu that greys out where
		// you already are makes you check twice which one that was.
		hint: voice.mode === id ? 'on' : hint,
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
		// The key is the whole instruction (#1879): a rider who picked this
		// mid-ride went quiet with no way to learn how to come back. And no
		// key, no mode — a control that cannot work is not drawn (ux.md).
		...(canHoldToTalk()
			? [mode('ptt', 'Push to talk', Mic, 'hold Space')]
			: []),
		...(inputs.length > 1
			? ([
					'separator',
					...inputs.map((device): MenuEntry => ({
						label: device.label,
						hint: device.value === voice.micId ? 'on' : undefined,
						onSelect: () => void voice.setMic(device.value),
					})),
				] satisfies MenuEntry[])
			: []),
		'separator',
		{
			label: 'Tune your gate…',
			icon: SlidersHorizontal,
			onSelect: openSoundPanel,
		},
	];
}
