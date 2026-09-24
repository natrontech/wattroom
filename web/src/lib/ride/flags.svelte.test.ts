// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
	flags: [] as { clientMs: number; note: string }[],
	submitted: [] as {
		clientMs: number;
		route: string;
		trainer: string;
		keepalive?: boolean;
	}[],
	refuse: 0,
}));
vi.mock('$lib/ride/flightrecorder.svelte', () => ({
	createFlightRecorder: () => ({
		get flags() {
			return fake.flags;
		},
		event: () => {},
		tick: () => {},
		flag: () => fake.flags.push({ clientMs: fake.flags.length + 1, note: '' }),
		submit: async (
			flag: { clientMs: number },
			meta: { route: string; trainer: string },
			keepalive?: boolean,
		) => {
			if (fake.refuse > 0) {
				fake.refuse--;
				return { ok: false, error: { message: 'Not now.' } };
			}
			fake.submitted.push({ clientMs: flag.clientMs, ...meta, keepalive });
			return { ok: true };
		},
	}),
}));

import { createRideFlags } from './flags.svelte';

describe('createRideFlags', () => {
	it('sends the unsent flags in order with the page and the trainer, and stops at a refusal', async () => {
		fake.flags.length = 0;
		fake.submitted.length = 0;
		const flags = createRideFlags('/ramp');
		flags.riding('Kickr Core', 'starting the ramp test');
		flags.recorder.flag();
		flags.recorder.flag();
		flags.recorder.flag();
		expect(flags.unsent).toHaveLength(3);

		fake.refuse = 1;
		await flags.send();
		expect(flags.sent).toBe(0);
		expect(flags.error).toBe('Not now.');
		expect(flags.unsent).toHaveLength(3);

		await flags.send();
		expect(flags.error).toBeNull();
		expect(flags.sent).toBe(3);
		expect(flags.unsent).toHaveLength(0);
		expect(fake.submitted.map((s) => s.clientMs)).toEqual([1, 2, 3]);
		expect(fake.submitted[0]).toMatchObject({
			route: '/ramp',
			trainer: 'Kickr Core',
		});
	});

	// The tap was the consent and the copy says "after the ride it sends"
	// (#2619): a rider who leaves the summary without pressing Send, or who
	// left mid-ride, must not find the flag was never sent.
	it('sends what is unsent when the page goes, once', () => {
		fake.flags.length = 0;
		fake.submitted.length = 0;
		const flags = createRideFlags('/ride');
		flags.riding('Kickr Core', 'starting Openers');
		flags.recorder.flag();
		flags.recorder.flag();

		flags.flush();
		expect(fake.submitted.map((s) => [s.clientMs, s.keepalive])).toEqual([
			[1, false],
			[2, false],
		]);
		expect(flags.unsent).toHaveLength(0);

		flags.flush();
		expect(fake.submitted).toHaveLength(2);
	});

	it('asks for keepalive only from a tab that is closing', () => {
		fake.flags.length = 0;
		fake.submitted.length = 0;
		const flags = createRideFlags('/ramp');
		flags.recorder.flag();
		flags.flush(true);
		expect(fake.submitted).toMatchObject([{ clientMs: 1, keepalive: true }]);
	});
});
