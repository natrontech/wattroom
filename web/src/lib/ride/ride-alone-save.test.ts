import { beforeEach, describe, expect, it, vi } from 'vitest';

const upload = vi.fn();
const toastSaved = vi.fn();
const push = vi.fn();
vi.mock('#lib/ride/save.ts', () => ({
	recordingUpload: () => ({}),
	toastSaved: (saved: unknown) => toastSaved(saved),
	uploadRide: () => upload(),
}));
vi.mock('#lib/toast.svelte.ts', () => ({ toasts: { push } }));
const kick = vi.fn();
vi.mock('#lib/ride/outbox.svelte.ts', () => ({
	outbox: { kick: () => kick() },
}));
vi.mock('#lib/account.svelte', () => ({ account: { me: { id: 'me' } } }));
vi.mock('#lib/history.svelte.ts', () => ({
	createHistoryStore: () => ({ remove: () => {}, add: () => null }),
	summarise: (samples: unknown[]) => ({ seconds: samples.length }),
}));

const { saveRideAlone } = await import('./ride-alone-save');

const ridden = {
	recording: [
		{
			second: 0,
			clock: 0,
			watts: 200,
			cadence: 90,
			heartRate: 0,
			bias: 1,
			released: false,
			virtualMps: 8,
		},
		{
			second: 1,
			clock: 1,
			watts: 210,
			cadence: 90,
			heartRate: 0,
			bias: 1,
			released: false,
			virtualMps: 8,
		},
	],
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
		kept: vi.fn(),
	};
}

/** A crash buffer whose last word on keeping the ride is `keeps`. */
function buffer(keeps: boolean) {
	return {
		crashSafe: keeps,
		keep: vi.fn(async (_samples: object[]) => keeps),
		append: vi.fn(),
		end: vi.fn(),
		release: vi.fn(),
		since: async () => [],
		retitle: vi.fn(),
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('saveRideAlone', () => {
	beforeEach(() => {
		upload.mockReset();
		toastSaved.mockReset();
		push.mockReset();
		kick.mockReset();
	});

	it('lands on the summary that shows its ride', async () => {
		upload.mockResolvedValue({
			saved: { id: 'r1', xp: 5, batzen: { earned: 3 } },
		});
		const a = answers(() => true);
		saveRideAlone(ridden, { buffer: undefined, borrowed: false, ftp: 200 }, a);
		await settle();
		// What the ride paid reaches the card with its XP (#4515).
		expect(a.saved).toHaveBeenCalledWith('r1', 5, { earned: 3 });
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

	// #4600: "kept on this device" was said whether or not it was.
	describe('a save that fails', () => {
		beforeEach(() =>
			upload.mockResolvedValue({
				failure: { message: 'Offline.', final: false },
			}),
		);

		it('writes every second to the device, then says it is kept', async () => {
			const kept = buffer(true);
			const a = answers(() => true);
			saveRideAlone(ridden, { buffer: kept, borrowed: false, ftp: 200 }, a);
			await settle();
			expect(kept.keep).toHaveBeenCalledWith([
				expect.objectContaining({ seq: 1, at: 0, watts: 200 }),
				expect.objectContaining({ seq: 2, at: 1000, watts: 210 }),
			]);
			// The road speed is never kept: no upload names it.
			expect(kept.keep.mock.calls[0]?.[0][0]).not.toHaveProperty('virtualMps');
			expect(kept.release).toHaveBeenCalled();
			expect(a.kept).toHaveBeenLastCalledWith(true);
			expect(a.status).toHaveBeenLastCalledWith(
				expect.stringContaining('saves on its own'),
				expect.any(Function),
			);
			expect(kick).toHaveBeenCalled();
		});

		it('says plainly when nothing would keep it', async () => {
			const a = answers(() => true);
			saveRideAlone(
				ridden,
				{ buffer: buffer(false), borrowed: false, ftp: 200 },
				a,
			);
			await settle();
			expect(a.kept).toHaveBeenLastCalledWith(false);
			expect(a.status).toHaveBeenLastCalledWith(
				expect.stringContaining('could not keep a copy'),
				expect.any(Function),
			);
			expect(kick).not.toHaveBeenCalled();
		});

		it('takes back the warning once a retry saves', async () => {
			const a = answers(() => true);
			saveRideAlone(
				ridden,
				{ buffer: buffer(false), borrowed: false, ftp: 200 },
				a,
			);
			await settle();
			upload.mockResolvedValue({ saved: { id: 'r1' } });
			const retry = a.status.mock.calls.at(-1)![1] as () => void;
			retry();
			await settle();
			expect(a.kept).toHaveBeenLastCalledWith(true);
		});
	});
});
