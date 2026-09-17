// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createPublish, type PublishHost } from '$lib/room/av-publish';

/**
 * The camera's flip (#2142: "front/back camera switching does not work").
 *
 * The flip itself wants a phone, and a browser pane will not hand one over —
 * but which way it asks the camera to face is ours, and it is the half that
 * broke in the rider's report: a control that turns nothing round is
 * indistinguishable from no control at all. So the constraint sent, the note
 * kept across a close, and the refusal path are pinned here.
 */

type Settings = { facingMode?: string };

function room(settings: Settings = {}) {
	const restarts: { facingMode?: string }[] = [];
	let refuse: Error | null = null;
	const videoTrack = {
		mediaStreamTrack: {
			getSettings: () => settings,
			stop: () => {},
		} as unknown as MediaStreamTrack,
		async restartTrack(constraints: { facingMode?: string }) {
			if (refuse) throw refuse;
			restarts.push(constraints);
			settings.facingMode = constraints.facingMode;
		},
	};
	let camera = true;
	return {
		restarts,
		refuseWith(cause: Error) {
			refuse = cause;
		},
		/** The camera comes back up as a fresh capture: front, and on the
		 *  platform this feature is for, saying nothing about it. */
		reopen() {
			camera = true;
			delete settings.facingMode;
		},
		conn: {
			liveKit: { Track: { Source: { Camera: 'camera' } } },
			room: {
				localParticipant: {
					getTrackPublication: (source: string) =>
						source === 'camera' && camera ? { videoTrack } : undefined,
					async setCameraEnabled(on: boolean) {
						camera = on;
					},
				},
			},
		},
	};
}

function publish(over: Partial<PublishHost> = {}) {
	const hw = room();
	const failedMedia = vi.fn();
	const av = { camOn: true, sharing: false } as PublishHost['av'];
	const api = createPublish({
		av,
		conn: hw.conn as unknown as PublishHost['conn'],
		seats: { drop: () => false } as unknown as PublishHost['seats'],
		stage: { dropVideo: () => {} } as unknown as PublishHost['stage'],
		failedMedia,
		...over,
	} as PublishHost);
	return { ...hw, av, api, failedMedia };
}

describe('the camera flip (#2142)', () => {
	// `facingMode`, not a deviceId: on iOS both lenses are one "camera" far
	// more often than not, which is why the picker never turned anything.
	it('asks for the other side, and keeps the publication', async () => {
		const { api, restarts } = publish();
		await api.flipCam();
		expect(restarts).toEqual([{ facingMode: 'environment' }]);
		await api.flipCam();
		expect(restarts.at(-1)).toEqual({ facingMode: 'user' });
	});

	// The silent one: a note kept across a close sent the first flip after a
	// reopen at the side the fresh capture was already on — a tap that does
	// nothing, which is the bug this feature exists to fix.
	it('forgets which way it faced once the camera is put down', async () => {
		const { api, av, reopen, restarts } = publish();
		await api.flipCam();
		await api.closeCam();
		reopen();
		av.camOn = true;
		await api.flipCam();
		expect(restarts).toEqual([
			{ facingMode: 'environment' },
			{ facingMode: 'environment' },
		]);
	});

	// Where the browser does say, its word beats the note — a rider who
	// picked the back lens in another tab is still facing that way.
	it('believes the track over its own note', async () => {
		const hw = room({ facingMode: 'environment' });
		const api = createPublish({
			av: { camOn: true } as PublishHost['av'],
			conn: hw.conn as unknown as PublishHost['conn'],
		} as PublishHost);
		await api.flipCam();
		expect(hw.restarts).toEqual([{ facingMode: 'user' }]);
	});

	// errors.md: a deliberate tap the rider watches for a result answers when
	// it is refused — the camera in use by another app is the common one.
	it('says so when the browser refuses the other lens', async () => {
		const { api, failedMedia, refuseWith, restarts } = publish();
		const cause = new Error('NotReadableError: in use');
		refuseWith(cause);
		await api.flipCam();
		expect(failedMedia).toHaveBeenCalledWith(cause, 'camera');
		expect(restarts).toEqual([]);
		// The note stays where it was, so the next press tries the same way
		// again rather than the side that just failed.
		refuseWith(null as unknown as Error);
		await api.flipCam();
		expect(restarts).toEqual([{ facingMode: 'environment' }]);
	});
});
