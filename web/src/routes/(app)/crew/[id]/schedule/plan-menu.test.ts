import { describe, expect, it, vi } from 'vitest';
import type { MenuEntry, MenuItem } from '$lib/context-menu.svelte';
import { planEntries, startHint, type PlanActions } from './plan-menu';

const act = (over: Partial<PlanActions> = {}): PlanActions => ({
	answer: null,
	choose: vi.fn(),
	share: vi.fn(),
	rearranges: false,
	move: vi.fn(),
	cancel: vi.fn(),
	startHint: '',
	start: vi.fn(),
	busy: false,
	...over,
});

const labels = (entries: MenuEntry[]) =>
	entries.map((e) => (e === 'separator' ? '—' : (e as MenuItem).label));
const item = (entries: MenuEntry[], label: string) =>
	entries.find((e) => e !== 'separator' && (e as MenuItem).label === label) as
		MenuItem | undefined;

describe('planEntries', () => {
	it('gives a member both answers, the link and Start, and nothing to rearrange', () => {
		expect(labels(planEntries(act()))).toEqual([
			"I'm in",
			"I'm out",
			'Copy link',
			'—',
			'Start now',
		]);
	});

	it('gives the planner and admins Move and a Cancel last, under a separator, in danger', () => {
		const entries = planEntries(act({ rearranges: true }));
		expect(labels(entries).slice(-4)).toEqual([
			'Start now',
			'Move…',
			'—',
			'Cancel the session',
		]);
		expect(item(entries, 'Cancel the session')?.danger).toBe(true);
	});

	it('says which answer is yours, and each answer does what the row’s button does', () => {
		const a = act({ answer: 'out' });
		const entries = planEntries(a);
		expect(item(entries, "I'm out")?.hint).toBe('your answer');
		expect(item(entries, "I'm in")?.hint).toBeUndefined();
		item(entries, "I'm in")?.onSelect();
		expect(a.choose).toHaveBeenCalledWith('in');
	});

	it('greys Start and names why', () => {
		const entries = planEntries(act({ startHint: 'not due yet' }));
		expect(item(entries, 'Start now')).toMatchObject({
			disabled: true,
			hint: 'not due yet',
		});
		expect(item(planEntries(act()), 'Start now')?.disabled).toBe(false);
	});
});

describe('startHint', () => {
	const ready = { due: true, spectator: false, voiceChannels: true };
	it('keeps the start on the screen a coach rides on (#1767)', () => {
		expect(startHint({ channelId: 'v' }, { ...ready, spectator: true })).toBe(
			'start it from the screen you ride on',
		);
	});
	it('waits until the plan is due', () => {
		expect(startHint({ channelId: 'v' }, { ...ready, due: false })).toBe(
			'not due yet',
		);
	});
	it('needs a voice channel for a plan that names none', () => {
		// Its row offers the channels (#2607); with none to offer, it says so.
		expect(startHint({}, { ...ready, voiceChannels: false })).toBe(
			'this crew has no voice channel you can start it in',
		);
		expect(startHint({}, ready)).toBe('');
		// A session already in its channel would refuse it (#2606).
		expect(startHint({ channelId: 'v' }, { ...ready, coaching: 'Ana' })).toBe(
			'Ana is coaching a session there',
		);
		expect(startHint({ channelId: 'v' }, ready)).toBe('');
	});
});
