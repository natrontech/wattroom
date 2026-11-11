import type { Component } from 'svelte';
import AlarmClockPlus from '@lucide/svelte/icons/alarm-clock-plus';
import Camera from '@lucide/svelte/icons/camera';
import CircleStop from '@lucide/svelte/icons/circle-stop';
import Flag from '@lucide/svelte/icons/flag';
import MonitorUp from '@lucide/svelte/icons/monitor-up';
import PartyPopper from '@lucide/svelte/icons/party-popper';
import Pause from '@lucide/svelte/icons/pause';
import Play from '@lucide/svelte/icons/play';
import SkipForward from '@lucide/svelte/icons/skip-forward';
import SwitchCamera from '@lucide/svelte/icons/switch-camera';
import type { GearState, PauseState, ViewState } from '$lib/protocol';
import { LAST_BLOCK, NO_BLOCKS } from '$lib/ride/remote-blocks';
import type { Offered } from '$lib/ride/ride-offers.svelte';
import { CAMERA_NAMES, type CameraPreset } from '$lib/world/cameras';
import type { ViewSegment } from '$lib/world/ride-view';

/**
 * The ride's controls, one list for the now bar and the phone remote (rider
 * feedback, 2026-11: the two had drifted apart). The bar draws each as a
 * 44 px icon with `label` as its name and tooltip; the phone draws the same
 * icon over `word`, and sends `action`. Easier / Harder and the view switch
 * are the two controls drawn their own way on both.
 *
 * Cheer and Talk are the phone's alone: the desk has the call's own mic and
 * cheers beside the ride.
 */
export type RideControl =
	| 'camera'
	| 'photo'
	| 'tv'
	| 'flag'
	| 'pause'
	| 'resume'
	| 'extend'
	| 'skip'
	| 'cheer-back'
	| 'end';

export const CONTROLS: Record<
	RideControl,
	{ label: string; word: string; icon: Component }
> = {
	camera: { label: 'Next camera', word: 'Camera', icon: SwitchCamera },
	photo: { label: 'Take the ride’s photo', word: 'Photo', icon: Camera },
	tv: { label: 'TV mode', word: 'TV', icon: MonitorUp },
	flag: { label: 'Flag a problem', word: 'Flag', icon: Flag },
	pause: { label: 'Pause', word: 'Pause', icon: Pause },
	resume: { label: 'Resume', word: 'Resume', icon: Play },
	extend: { label: 'One more minute', word: '+1 min', icon: AlarmClockPlus },
	skip: { label: 'Skip block', word: 'Skip', icon: SkipForward },
	'cheer-back': { label: 'Cheer', word: 'Cheer', icon: PartyPopper },
	end: { label: 'End ride', word: 'End', icon: CircleStop },
};

/** Why Camera and Photo wait, on the bar and the phone. */
export const NEEDS_3D = 'Camera and Photo need 3D.';

/** Why TV and Flag wait on the phone: the riding screen has neither now. */
export const NOT_ON_SCREEN = 'TV and Flag are not on your riding screen now.';

export const LOOK_WORDS: Record<ViewSegment, string> = {
	'3d': '3D',
	flat: 'Flat',
	map: 'Map',
	room: 'Room',
};

export type PhoneTile = {
	control: RideControl;
	disabled: boolean;
	/** A toggle that is on: TV up, the ride paused. */
	pressed?: boolean;
};

export type PhoneView = {
	view: ViewState | null;
	pause: PauseState | null;
	/** The ride is in a voice channel: Cheer and Talk have somewhere to go. */
	social: boolean;
};

const offers = (view: ViewState | null, action: Offered) =>
	!!view?.offers?.includes(action);

/**
 * The phone's tiles, in the bar's order, each held while the riding screen
 * cannot run it. A control that never applies to this ride is left off:
 * Camera and Photo off a road, Pause, +1 min and Skip on a session (its
 * clock is the coach's), Cheer alone, End where the bar has no End ride. One hint, the first that
 * applies, says why a tile waits.
 */
export function phoneTiles({ view, pause, social }: PhoneView): {
	tiles: PhoneTile[];
	hint: string | null;
} {
	const world = !!view?.world;
	// Camera and Photo turn a world: off a road, or where this screen cannot
	// draw one, the bar has neither, so the phone has neither.
	const worldly = !view || world || offers(view, 'view-3d');
	const screen = { tv: offers(view, 'tv'), flag: offers(view, 'flag') };
	const tiles: PhoneTile[] = [
		...(worldly
			? [
					{ control: 'camera', disabled: !world } as const,
					{ control: 'photo', disabled: !world } as const,
				]
			: []),
		{ control: 'tv', disabled: !screen.tv, pressed: !!view?.tv },
		{ control: 'flag', disabled: !screen.flag },
	];
	if (pause?.pausable) {
		tiles.push(
			pause.paused
				? { control: 'resume', disabled: false, pressed: true }
				: { control: 'pause', disabled: false },
			{ control: 'extend', disabled: !pause.blocks },
			{ control: 'skip', disabled: !pause.blocks || !!pause.last },
		);
	}
	if (social) tiles.push({ control: 'cheer-back', disabled: false });
	if (offers(view, 'end')) tiles.push({ control: 'end', disabled: false });

	const hint = !view
		? null
		: worldly && !world
			? NEEDS_3D
			: pause?.pausable && !pause.blocks
				? NO_BLOCKS
				: pause?.pausable && pause.last
					? LAST_BLOCK
					: !screen.tv || !screen.flag
						? NOT_ON_SCREEN
						: null;
	return { tiles, hint };
}

/** The view row: the switch's segments the riding screen draws, and which is pressed. */
export function phoneViews(
	view: ViewState | null,
): { segment: ViewSegment; pressed: boolean }[] {
	return (['3d', 'flat', 'map', 'room'] as const)
		.filter((s) => offers(view, `view-${s}`))
		.map((segment) => ({ segment, pressed: view?.look === segment }));
}

/**
 * The phone's neon line (#4223, #4253): what the riding screen shows now,
 * as it last said ("Paused · 3D · Chase · TV"), or what the last Photo or
 * Flag did once the screen's count rose past the one the phone saw when it
 * was pressed.
 */
export function remoteLine(
	view: ViewState | null,
	paused: boolean,
	since: { pictures: number | null; flags: number | null },
): string | null {
	if (!view) return null;
	if (since.pictures !== null && (view.pictures ?? 0) > since.pictures)
		return 'Picture taken';
	if (since.flags !== null && (view.flags ?? 0) > since.flags) return 'Flagged';
	const look = LOOK_WORDS[view.look as ViewSegment];
	return [
		paused ? 'Paused' : '',
		look ?? '',
		view.world && view.camera
			? (CAMERA_NAMES[view.camera as CameraPreset] ?? '')
			: '',
		view.tv ? 'TV' : '',
	]
		.filter(Boolean)
		.join(' · ');
}

/**
 * The holder's answer to Easier / Harder in words (#4235, #3334): a gear is
 * named, as the computer's field is, since a blind gear reads a bare "0";
 * the bias or the watts already say what they are. "· end" when the next tap
 * would move nothing.
 */
export function answerLine({ label, atEnd }: GearState): string {
	const words = /^[+−]?\d+$/.test(label) ? `Gear ${label}` : label;
	return atEnd ? `${words} · end` : words;
}
