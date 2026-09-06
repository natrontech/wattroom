/**
 * You, as an object (#898). The you-panel at the foot of the sidebar already
 * carries two destinations; this is where the cue level joins them, on the
 * same rule as a rider's volume (#874): a control lives on the thing it
 * belongs to. The cues fire from the room, from chat, from a poke and from a
 * toast, so no surface owns them — but they are *yours*, per device, wherever
 * you are, and this is the one object that is you on every screen.
 */
import { Bell, Settings, User } from '@lucide/svelte';
import type { MenuEntry, MenuSlider } from '$lib/context-menu.svelte';
import { play } from '$lib/sound/cues';
import { mixer } from '$lib/sound/mixer.svelte';

/** Percent, like every other fader in a menu; `mixer.cues` is a 0–1 gain. */
const cueFader = (): MenuSlider => ({
	kind: 'slider',
	label: 'Cue sounds',
	icon: Bell,
	min: 0,
	max: 100,
	step: 1,
	value: Math.round(mixer.cues * 100),
	format: (percent) => `${percent}%`,
	onInput: (percent) => mixer.setCues(percent / 100),
	// On release, not on every input: a level you cannot hear is not a level
	// you can set, and playing through a drag is a machine gun.
	onChange: () => play('block'),
});

export function youMenu(
	id: string | undefined,
	go: (href: string) => void,
): MenuEntry[] {
	return [
		{
			label: 'Your rider page',
			icon: User,
			onSelect: () => id && go(`/u/${id}`),
			disabled: !id,
		},
		{ label: 'Settings', icon: Settings, onSelect: () => go('/profile') },
		'separator',
		cueFader(),
	];
}
