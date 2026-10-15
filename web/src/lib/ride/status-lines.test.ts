import { describe, expect, it } from 'vitest';
import {
	buildingLine,
	statusLine,
	type StatusState,
} from '$lib/ride/status-lines';

describe('slot 1 status lines (#3212)', () => {
	const table: [StatusState, string, string | undefined][] = [
		['trainer-quiet', 'Your trainer went quiet.', 'Reconnect trainer'],
		['guard-released', 'Trainer released for 10 s, spin up.', undefined],
		['socket-down', 'Reconnecting, your ride is still recording.', undefined],
		['voice-down', 'Voice reconnecting', undefined],
		[
			'road-removed',
			'This road was removed by its owner, riding on without it.',
			undefined,
		],
		[
			'map-not-yours',
			"You ride this road's heights; its map is its owner's.",
			undefined,
		],
		[
			'server-restarted',
			'The server restarted, your ride came back from this browser.',
			undefined,
		],
	];

	it.each(table)(
		'%s says its line and offers its button',
		(state, text, action) => {
			const line = statusLine(state);
			expect(line.text).toBe(text);
			expect(line.action).toBe(action);
		},
	);

	it('only the quiet trainer is an alert', () => {
		const alerts = table.filter(([s]) => statusLine(s).alert).map(([s]) => s);
		expect(alerts).toEqual(['trainer-quiet']);
	});

	it.each([
		[60, 'Building the road... 60 %'],
		[59.6, 'Building the road... 60 %'],
		[-5, 'Building the road... 0 %'],
		[140, 'Building the road... 100 %'],
	])('build slow at %s reads %s', (percent, text) => {
		expect(buildingLine(percent).text).toBe(text);
	});
});
