import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvStatus } from './av-types';
import { createVoiceRecovery, RECOVER_DELAYS_MS } from './voice-recover';

// The drop-rejoin used to try once, two seconds after the drop, while the
// network was usually still down (#4343).
describe('voice recovery after a drop', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const rig = (outcomes: AvStatus[], over: { signedOut?: boolean } = {}) => {
		let status: AvStatus = 'off';
		const queue = [...outcomes];
		const join = vi.fn(async () => {
			status = queue.shift() ?? 'live';
		});
		const recovery = createVoiceRecovery({
			join,
			status: () => status,
			signedOut: () => over.signedOut ?? false,
			stillHere: () => true,
		});
		return { recovery, join };
	};

	it('keeps trying, with a growing wait, until the call is back', async () => {
		const { recovery, join } = rig(['failed', 'failed', 'live']);
		recovery.dropped();
		await vi.advanceTimersByTimeAsync(RECOVER_DELAYS_MS[0]);
		expect(join).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(RECOVER_DELAYS_MS[1]);
		expect(join).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(RECOVER_DELAYS_MS[2]);
		expect(join).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(join).toHaveBeenCalledTimes(3);
	});

	it('tries at once when the network returns', async () => {
		const { recovery, join } = rig(['failed', 'live']);
		recovery.dropped();
		await vi.advanceTimersByTimeAsync(RECOVER_DELAYS_MS[0]);
		recovery.online();
		await vi.advanceTimersByTimeAsync(0);
		expect(join).toHaveBeenCalledTimes(2);
	});

	it('stands down when the rider hangs up', async () => {
		const { recovery, join } = rig(['failed', 'failed']);
		recovery.dropped();
		await vi.advanceTimersByTimeAsync(RECOVER_DELAYS_MS[0]);
		recovery.left();
		recovery.online();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(join).toHaveBeenCalledTimes(1);
	});

	it('stops on a refusal a retry cannot fix', async () => {
		const { recovery, join } = rig(['failed', 'failed'], { signedOut: true });
		recovery.dropped();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(join).toHaveBeenCalledTimes(1);
	});

	it('stays out when the voice is on another screen', async () => {
		const { recovery, join } = rig(['off', 'live']);
		recovery.dropped();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(join).toHaveBeenCalledTimes(1);
	});

	it('does nothing on a network return it was not waiting for', async () => {
		const { recovery, join } = rig([]);
		recovery.online();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(join).not.toHaveBeenCalled();
	});
});
