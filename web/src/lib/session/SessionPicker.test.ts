import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import SessionPicker from './SessionPicker.svelte';
import type { ShelfEntry } from '#lib/workout/shelf.ts';

vi.mock('$app/state', () => ({
	page: { url: new URL('http://x/crew/c1/v/v1') },
}));
vi.mock('#lib/api.ts', () => ({
	api: () => new Promise(() => {}),
}));

const entry = (id: string, name: string): ShelfEntry => ({
	id,
	yours: true,
	workout: {
		name,
		author: 'you',
		steps: [{ type: 'steady', seconds: 600, target: 0.6 }],
	},
});

const picker = (pick?: string, road?: string) =>
	render(SessionPicker, {
		props: {
			// Your last ride first, as the shelf ranks it: the picker opened
			// on it and not on the workout the rider had just built.
			shelf: [entry('w1', 'Last Ridden'), entry('w2', 'Just Built')],
			ftp: 250,
			pick,
			road,
			onStart: () => {},
			onPlan: () => {},
			onClose: () => {},
		},
	}).body;

describe('the picker (#4082)', () => {
	it('opens on the workout just built, wherever the shelf ranks it', () => {
		const body = picker('w2');
		expect(body).toContain('Start Just Built');
		expect(body).not.toContain('Start Last Ridden');
	});

	it('opens on the top of the shelf otherwise', () => {
		expect(picker()).toContain('Start Last Ridden');
	});

	it('offers to build one, coming back to this channel', () => {
		expect(picker()).toContain(
			'href="/workouts/edit?back=%2Fcrew%2Fc1%2Fv%2Fv1%3Fpicker%3Dstart"',
		);
	});

	it('keeps the road it opened on through the editor (#4224)', () => {
		expect(picker(undefined, 'r7')).toContain(
			'href="/workouts/edit?back=%2Fcrew%2Fc1%2Fv%2Fv1%3Fpicker%3Dstart%26road%3Dr7"',
		);
	});
});

// One door to a session (#4564): Ride together is the picker's first
// choice, above the workouts, and only where the picker can start one.
describe('Ride together in the picker', () => {
	const props = {
		shelf: [entry('w1', 'Last Ridden')],
		ftp: 250,
		onStart: () => {},
		onPlan: () => {},
		onClose: () => {},
		onTogether: () => {},
	};

	it('comes first, before the workouts', () => {
		const body = render(SessionPicker, { props }).body;
		expect(body).toContain('Ride together');
		expect(body.indexOf('Ride together')).toBeLessThan(
			body.indexOf('Start Last Ridden'),
		);
	});

	it('is not offered where the picker only plans', () => {
		const body = render(SessionPicker, {
			props: { ...props, intent: 'plan' as const },
		}).body;
		expect(body).not.toContain('Ride together');
	});
});
