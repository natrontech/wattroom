import { describe, expect, it } from 'vitest';
import type { LiveStats } from '$lib/ride/live-stats.svelte';
import {
	fieldsFor,
	pagesFor,
	turned,
	type ComputerContext,
} from './computer-pages';

const stats: LiveStats = {
	seconds: 600,
	power3: 251,
	power10: 248,
	power30: 240,
	normPower: 236,
	intensity: 0.944,
	load: 14.85,
	kj: 142,
	zoneSeconds: [0, 60, 120, 200, 150, 50, 15, 5],
	blockAverage: 238,
	blockExecution: 0.9,
};

const ride = (over: Partial<ComputerContext> = {}): ComputerContext => ({
	watts: 262,
	cadence: 92,
	hr: 0,
	kg: 75,
	stale: false,
	stats,
	...over,
});

const keys = (fields: { key: string }[]) => fields.map((f) => f.key);
const field = (fields: { key: string }[], key: string) =>
	fields.find((f) => f.key === key) as ReturnType<typeof fieldsFor>[number];

describe('RIDE (ADR-0071)', () => {
	it('is power, cadence and W/kg with nothing else to show', () => {
		expect(keys(fieldsFor('ride', ride()))).toEqual([
			'power',
			'cadence',
			'wkg',
		]);
	});

	it('shows the 3 s average as its power once one exists, and this second before', () => {
		expect(field(fieldsFor('ride', ride()), 'power').value).toBe('251');
		const first = ride({ stats: { ...stats, seconds: 0 } });
		expect(field(fieldsFor('ride', first), 'power').value).toBe('262');
		expect(
			field(fieldsFor('ride', ride({ stats: undefined })), 'power').value,
		).toBe('262');
	});

	it('shows heart rate only with a reading, zoned by your own LTHR', () => {
		const fields = fieldsFor('ride', ride({ hr: 150, lthr: 165 }));
		expect(keys(fields)).toContain('hr');
		expect(field(fields, 'hr').zone).toBeGreaterThan(0);
	});

	it('adds your execution alone, the grade on a slope and the gear in neon', () => {
		const fields = fieldsFor(
			'ride',
			ride({ execution: 0.87, grade: 4, gear: 'Gear 15' }),
		);
		expect(keys(fields)).toEqual([
			'power',
			'grade',
			'cadence',
			'wkg',
			'execution',
			'gear',
		]);
		expect(field(fields, 'execution').value).toBe('87');
		expect(field(fields, 'gear')).toMatchObject({ value: '15', neon: true });
		expect(field(fieldsFor('ride', ride({ gear: '+3' })), 'gear').value).toBe(
			'+3',
		);
	});

	it('reads a road as speed and distance "x of y"', () => {
		const fields = fieldsFor(
			'ride',
			ride({ road: { speedKph: 31.24, km: 3.21, ofKm: 24 } }),
		);
		expect(keys(fields).slice(0, 3)).toEqual(['power', 'speed', 'distance']);
		expect(field(fields, 'speed').value).toBe('31.2');
		expect(field(fields, 'distance').value).toBe('3.2 of 24.0');
	});
});

describe('POWER (ADR-0071)', () => {
	it('is the rolling powers, the block, NormPower, Intensity, the work and Load', () => {
		const fields = fieldsFor('power', ride({ target: 240 }));
		expect(fields.map((f) => [f.label, f.value, f.unit])).toEqual([
			['3 s', '251', 'W'],
			['10 s', '248', 'W'],
			['30 s', '240', 'W'],
			['Block', '238/240', 'W'],
			['NormPower', '236', 'W'],
			['Intensity', '0.94', undefined],
			['Work', '+142', 'XP'],
			['Load', '15', undefined],
		]);
	});

	it('reads the average where no block asks for anything', () => {
		expect(field(fieldsFor('power', ride()), 'block')).toMatchObject({
			label: 'Average',
			value: '238',
		});
	});

	it('names nothing by a trademark (docs/SPEC.md)', () => {
		const labels = fieldsFor('power', ride()).map((f) => f.label);
		for (const mark of ['TSS', 'IF', 'NP']) expect(labels).not.toContain(mark);
	});
});

describe('the glow', () => {
	it('marks the 3 s power and nothing else, on either page', () => {
		const all = ride({
			hr: 150,
			lthr: 165,
			execution: 0.9,
			grade: 3,
			gear: 'Gear 9',
			target: 240,
			road: { speedKph: 30, km: 1, ofKm: 10 },
		});
		const glowing = (page: 'ride' | 'power') =>
			fieldsFor(page, all)
				.filter((f) => f.glow)
				.map((f) => f.key);
		expect(glowing('ride')).toEqual(['power']);
		expect(glowing('power')).toEqual(['power3']);
	});

	it('goes out, with the numbers, when nothing is measured', () => {
		const stale = ride({ stale: true, hr: 150 });
		for (const page of ['ride', 'power'] as const)
			expect(fieldsFor(page, stale).filter((f) => f.glow)).toEqual([]);
		expect(field(fieldsFor('ride', stale), 'power').value).toBe('—');
		expect(field(fieldsFor('power', stale), 'power3').value).toBe('—');
	});
});

describe('the pages', () => {
	it('keeps POWER for a screen with its own live numbers', () => {
		expect(pagesFor(stats)).toEqual(['ride', 'power']);
		expect(pagesFor(undefined)).toEqual(['ride']);
	});

	it('turns both ways and wraps', () => {
		const pages = pagesFor(stats);
		expect(turned(pages, 'ride', 1)).toBe('power');
		expect(turned(pages, 'power', 1)).toBe('ride');
		expect(turned(pages, 'ride', -1)).toBe('power');
		expect(turned(['ride'], 'ride', 1)).toBe('ride');
	});
});
