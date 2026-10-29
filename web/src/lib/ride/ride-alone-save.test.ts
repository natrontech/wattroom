import { beforeEach, describe, expect, it, vi } from 'vitest';

const upload = vi.fn();
const toastSaved = vi.fn();
const push = vi.fn();
vi.mock('$lib/ride/save', () => ({
	ROAD_LEFT_OFF: 'left off',
	recordingUpload: () => ({}),
	toastSaved: (saved: unknown) => toastSaved(saved),
	uploadRide: () => upload(),
}));
vi.mock('$lib/toast.svelte', () => ({ toasts: { push } }));
vi.mock('$lib/account.svelte', () => ({ account: { me: { id: 'me' } } }));
vi.mock('$lib/history.svelte', () => ({
	createHistoryStore: () => ({ remove: () => {}, add: () => null }),
	summarise: (samples: unknown[]) => ({ seconds: samples.length }),
}));

const { saveRideAlone } = await import('./ride-alone-save');

const ridden = {
	recording: [{}, {}],
	startedAt: new Date(0),
	ridden: { name: 'Openers' },
	execution: 0,
	scored: false,
} as unknown as Parameters<typeof saveRideAlone>[0];

function answers(current: () => boolean, seen = () => true) {
	return {
		current,
		seen,
		saving: vi.fn(),
		status: vi.fn(),
		saved: vi.fn(),
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('saveRideAlone', () => {
	beforeEach(() => {
		upload.mockReset();
		toastSaved.mockReset();
		push.mockReset();
	});

	it('lands on the summary that shows its ride', async () => {
		upload.mockResolvedValue({ saved: { id: 'r1', xp: 5 } });
		const a = answers(() => true);
		saveRideAlone(ridden, { buffer: undefined, borrowed: false, ftp: 200 }, a);
		await settle();
		expect(a.saved).toHaveBeenCalledWith('r1', 5);
		expect(toastSaved).not.toHaveBeenCalled();
	});

	it('leaves the next ride’s summary alone and says itself in a toast', async () => {
		upload.mockResolvedValue({ saved: { id: 'r1', xp: 5 } });
		let mine = true;
		const a = answers(() => mine);
		saveRideAlone(ridden, { buffer: undefined, borrowed: false, ftp: 200 }, a);
		// The rider dismissed the summary and started another ride meanwhile.
		mine = false;
		await settle();
		expect(a.saved).not.toHaveBeenCalled();
		expect(a.status).not.toHaveBeenCalled();
		expect(toastSaved).toHaveBeenCalled();
	});

	it('says a failure of an earlier ride as a toast, with no retry on the next one', async () => {
		upload.mockResolvedValue({
			failure: { message: 'Offline.', final: false },
		});
		let mine = true;
		const a = answers(() => mine);
		saveRideAlone(ridden, { buffer: undefined, borrowed: false, ftp: 200 }, a);
		mine = false;
		await settle();
		expect(a.status).not.toHaveBeenCalled();
		expect(push).toHaveBeenCalledWith(expect.stringContaining('Offline.'), {
			tone: 'error',
		});
	});
});
