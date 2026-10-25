import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import SessionPicker from './SessionPicker.svelte';
import type { ShelfEntry } from '$lib/workout/shelf';

vi.mock('$app/state', () => ({
	page: { url: new URL('http://x/crew/c1/v/v1') },
}));
vi.mock('$lib/api', () => ({
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

const picker = (pick?: string) =>
	render(SessionPicker, {
		props: {
			// Your last ride first, as the shelf ranks it: the picker opened
			// on it and not on the workout the rider had just built.
			shelf: [entry('w1', 'Last Ridden'), entry('w2', 'Just Built')],
			ftp: 250,
			pick,
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
});
