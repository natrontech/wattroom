import { describe, expect, it, vi } from 'vitest';

const calls: unknown[][] = [];
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('#lib/crew-schedule.ts', () => ({
	startCrewPlan: (...args: unknown[]) => {
		calls.push(['plan', ...args]);
		return Promise.resolve({
			ok: true,
			data: { channelId: '', sessionId: 's2' },
		});
	},
}));
vi.mock('#lib/session/crew-session.ts', () => ({
	startCrewSession: (...args: unknown[]) => {
		calls.push(['pick', ...args]);
		return Promise.resolve({ ok: true, data: { id: 's3' } });
	},
	startRideTogether: (...args: unknown[]) => {
		calls.push(['together', ...args]);
		return Promise.resolve({ ok: true, data: { id: 's4' } });
	},
}));

const { reopener } = await import('./cancel');

const tempo = { name: 'Tempo', steps: [] };

// The Undo of a cancel (#4562) opens the same session again: the plan it
// came from, a Ride together, or the same pick on the same road.
describe('reopener', () => {
	it('starts the plan again, and answers with its session', async () => {
		calls.length = 0;
		const again = reopener('c1', { phase: 'idle', planId: 'p1' });
		expect(await again?.()).toMatchObject({ ok: true, data: { id: 's2' } });
		expect(calls).toEqual([['plan', 'c1', 'p1']]);
	});

	it('opens the same pick on the same stretch of road', async () => {
		calls.length = 0;
		await reopener('c1', {
			phase: 'idle',
			workoutJson: JSON.stringify(tempo),
			route: {
				id: 'r1',
				hash: 'h',
				genName: 'g',
				fromM: 400,
				lengthM: 2400,
				reverse: true,
			},
		})?.();
		expect(calls).toEqual([
			[
				'pick',
				'c1',
				tempo,
				{ id: 'r1', fromM: 400, reverse: true, loop: undefined },
			],
		]);
	});

	it('rides together again', async () => {
		calls.length = 0;
		await reopener('c1', { phase: 'idle', together: true })?.();
		expect(calls).toEqual([['together', 'c1']]);
	});

	it('has nothing to reopen a game or a broken pick with', () => {
		expect(reopener('c1', { phase: 'running' })).toBeUndefined();
		expect(reopener('c1', { phase: 'idle', workoutJson: '{' })).toBeUndefined();
		expect(reopener('c1', undefined)).toBeUndefined();
	});
});
