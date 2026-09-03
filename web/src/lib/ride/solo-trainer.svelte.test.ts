// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Trainer, TrainerSample, TrainerStatus } from '$lib/ble/trainer';

/** The room a solo screen has to take the trainer back from (#521). */
const unpair = vi.fn();
vi.mock('$lib/room/connection.svelte', () => ({
	roomConnection: {
		get current() {
			return { ride: { unpair } };
		},
	},
}));

const { createSoloTrainer } = await import('./solo-trainer.svelte');

class FakeTrainer implements Trainer {
	status: TrainerStatus = 'disconnected';
	mode = 'erg' as const;
	connects = 0;
	disconnects = 0;
	targets: number[] = [];
	private samples: ((sample: TrainerSample) => void)[] = [];
	constructor(
		readonly name = 'Kickr',
		private readonly fail?: string,
	) {}
	async connect() {
		this.connects++;
		if (this.fail) throw new Error(this.fail);
		this.status = 'connected';
	}
	async disconnect() {
		this.disconnects++;
		this.status = 'disconnected';
	}
	async setTargetPower(watts: number) {
		this.targets.push(watts);
	}
	async setSimulation() {}
	onSample(cb: (sample: TrainerSample) => void) {
		this.samples.push(cb);
		return () => {
			this.samples = this.samples.filter((other) => other !== cb);
		};
	}
	onStatus() {
		return () => {};
	}
	/** One ~1 Hz reading, as the BLE layer would deliver it. */
	pedal(watts: number, cadence = 90) {
		for (const cb of this.samples) cb({ watts, cadence, at: Date.now() });
	}
	get listeners() {
		return this.samples.length;
	}
}

/** Runs `body` in an effect context, as component init would. */
function withSlot(
	body: (slot: ReturnType<typeof createSoloTrainer>) => Promise<void> | void,
) {
	let slot!: ReturnType<typeof createSoloTrainer>;
	const dispose = $effect.root(() => {
		slot = createSoloTrainer();
	});
	return Promise.resolve(body(slot)).finally(dispose);
}

afterEach(() => {
	unpair.mockClear();
	vi.useRealTimers();
});

describe('the solo pre-ride trainer slot (#611)', () => {
	it('holds a paired trainer without riding it', async () => {
		await withSlot(async (slot) => {
			const trainer = new FakeTrainer('Kickr Core');
			await slot.pair(trainer);

			expect(slot.state).toBe('connected');
			expect(slot.trainer).toBe(trainer);
			// Pairing is not starting: nothing may hold a target before the
			// rider presses Start, or the frame is loaded with nobody on it.
			expect(trainer.targets).toEqual([]);
			// No sample yet means no reading — a name alone cannot tell a
			// working trainer from a silent one.
			expect(slot.reading).toBeUndefined();

			trainer.pedal(184, 88);
			expect(slot.reading).toBe('184 W · 88 rpm');
		});
	});

	it('takes the trainer back from a room you are standing in', async () => {
		await withSlot(async (slot) => {
			await slot.pair(new FakeTrainer());
			expect(unpair).toHaveBeenCalledTimes(1);
		});
	});

	it('reports a failed connect and holds nothing', async () => {
		await withSlot(async (slot) => {
			const trainer = new FakeTrainer('Kickr', 'No device picked.');
			await slot.pair(trainer);

			expect(slot.state).toBe('failed');
			expect(slot.error).toBe('No device picked.');
			expect(slot.trainer).toBeNull();
			// The failed attempt left no listener behind to leak into the next.
			expect(trainer.listeners).toBe(0);
		});
	});

	it('hands the live connection to the session without dropping it', async () => {
		await withSlot(async (slot) => {
			const trainer = new FakeTrainer();
			await slot.pair(trainer);

			expect(slot.handOff()).toBe(trainer);
			// The session connects only if it has to; a handed-off trainer is
			// already connected and must not be re-dialled or hung up.
			expect(trainer.status).toBe('connected');
			expect(trainer.disconnects).toBe(0);
			expect(trainer.connects).toBe(1);
			// The slot is empty and no longer watching, so Start cannot fire twice.
			expect(slot.trainer).toBeNull();
			expect(slot.state).toBe('idle');
			expect(trainer.listeners).toBe(0);
			expect(slot.handOff()).toBeNull();
		});
	});

	it('forgetting disconnects and clears the card', async () => {
		await withSlot(async (slot) => {
			const trainer = new FakeTrainer();
			await slot.pair(trainer);
			trainer.pedal(200);

			slot.forget();

			expect(trainer.disconnects).toBe(1);
			expect(slot.trainer).toBeNull();
			expect(slot.state).toBe('idle');
			expect(slot.reading).toBeUndefined();
			expect(trainer.listeners).toBe(0);
		});
	});

	// #520 on the pre-ride screen: "paired" was the only state it could show,
	// so a trainer that delivered not one watt read as ready to ride.
	it('calls a silent trainer silent after ten seconds', async () => {
		vi.useFakeTimers();
		await withSlot(async (slot) => {
			const trainer = new FakeTrainer();
			await slot.pair(trainer);
			flushSync();

			expect(slot.fault).toBeNull();

			vi.advanceTimersByTime(11_000);
			flushSync();
			expect(slot.fault).toBe('silent');
			// Silent is not disconnected: the card still says which trainer.
			expect(slot.state).toBe('connected');

			trainer.pedal(150);
			flushSync();
			expect(slot.fault).toBeNull();
		});
	});
});
