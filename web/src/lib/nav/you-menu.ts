/**
 * You, as an object (#898, #904). The you-panel at the foot of the sidebar
 * already carries two destinations; this is where your mix joins them, on the
 * same rule as a rider's volume (#874): a control lives on the thing it
 * belongs to. Neither the cue level nor the duck depth has a surface of its
 * own — cues fire from the room, from chat, from a poke and from a toast, and
 * the dip touches music and cues alike — but both are *yours*, per device,
 * and this is the one object that is you on every screen.
 */
import { Bell, ChevronsDown, Settings, User } from '@lucide/svelte';
import type { MenuEntry, MenuSlider } from '$lib/context-menu.svelte';
import { roomConnection } from '$lib/room/connection.svelte';
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

/**
 * How far music and cues dip while someone is speaking (#904). The same mix
 * as the cues, and the same object: it is not the jukebox's property — the
 * cues dip too — and it is not one rider's. Offered only in a room, because
 * outside one there is no voice to dip under.
 *
 * Right is off, exactly as the Sound panel's fader reads: two homes for one
 * control must not disagree about which way is louder.
 */
function duckFader(): MenuSlider | undefined {
	if (!roomConnection.current) return undefined;
	return {
		kind: 'slider',
		label: 'Duck under voice',
		icon: ChevronsDown,
		min: 0,
		max: 100,
		step: 1,
		value: Math.round(mixer.duck * 100),
		format: (percent) => (percent === 100 ? 'off' : `−${100 - percent}%`),
		onInput: (percent) => mixer.setDuck(percent / 100),
	};
}

export function youMenu(
	id: string | undefined,
	go: (href: string) => void,
): MenuEntry[] {
	const duck = duckFader();
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
		...(duck ? [duck] : []),
	];
}
