/**
 * What to tell a rider when the browser would not hand over a device (#642).
 * getUserMedia and getDisplayMedia reject with a DOMException whose `name`
 * is the only reliable signal — `message` differs per browser and is written
 * for developers. errors.md: what went wrong, why, and what to do next.
 */
export type MediaDevice = 'microphone' | 'camera' | 'screen';

const NOUN: Record<MediaDevice, string> = {
	microphone: 'the microphone',
	camera: 'the camera',
	screen: 'screen sharing',
};

/**
 * One line for the sidebar's status block, or null when there is nothing to
 * say: a screen picker the rider closed themselves rejects with the same
 * NotAllowedError as a policy block, and a rider who just pressed Cancel
 * does not need telling that they did.
 */
export function describeMediaError(
	err: unknown,
	device: MediaDevice,
): string | null {
	const name = err instanceof Error ? err.name : '';
	const noun = NOUN[device];
	switch (name) {
		case 'NotAllowedError':
		case 'PermissionDeniedError':
		case 'SecurityError':
			if (device === 'screen') return null;
			return `Your browser is blocking ${noun} — allow it in the address bar and try again.`;
		case 'NotFoundError':
		case 'DevicesNotFoundError':
			return device === 'screen'
				? 'Nothing to share was found — try again.'
				: `No ${noun.replace('the ', '')} found — plug one in and try again.`;
		case 'NotReadableError':
		case 'TrackStartError':
		case 'AbortError':
			return `Another app is using ${noun} — close it and try again.`;
		default:
			return `${capitalize(noun)} could not be started — try again.`;
	}
}

function capitalize(s: string) {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
