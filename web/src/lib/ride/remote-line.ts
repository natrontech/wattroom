import type { GearState, ViewState } from '$lib/protocol';
import { PAGE_NAMES, type ComputerPage } from '$lib/session/computer-pages';
import { CAMERA_NAMES, type CameraPreset } from '$lib/world/cameras';

/**
 * The phone remote's neon line (#4223, #4253): what the riding screen shows
 * now, as it last said ("RIDE · 3D · Chase"), or "Picture taken" once its
 * count of pictures rose past the one it had when Photo was pressed.
 */
export function remoteLine(
	view: ViewState | null,
	photoFrom: number | null,
): string | null {
	if (!view) return null;
	if (photoFrom !== null && (view.pictures ?? 0) > photoFrom)
		return 'Picture taken';
	return [
		PAGE_NAMES[view.page as ComputerPage] ?? view.page.toUpperCase(),
		view.world ? '3D' : 'Flat',
		view.world && view.camera
			? (CAMERA_NAMES[view.camera as CameraPreset] ?? '')
			: '',
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
