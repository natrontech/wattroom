import { describe, expect, it } from 'vitest';
import {
	backFrom,
	buildFromPicker,
	startDoor,
	takePickerDoor,
	withPick,
} from './doors';

const at = (path: string) => new URL(path, 'http://x');

describe('the start door (#4224)', () => {
	it('opens the channel picker on the workout and road picked outside it', () => {
		const door = takePickerDoor(
			at(startDoor('/crew/c1/v/v1/training', 'w7', 'r3')),
		)!;
		expect(door).toMatchObject({ intent: 'start', pick: 'w7', road: 'r3' });
		expect(door.rest.pathname + door.rest.search).toBe(
			'/crew/c1/v/v1/training',
		);
		expect(
			takePickerDoor(at(startDoor('/crew/c1/v/v1/training', 'w7'))),
		).toMatchObject({ pick: 'w7', road: undefined });
	});
});

describe('the picker door (#4082)', () => {
	it('goes to the editor and comes back to the picker, open on the new workout', () => {
		const editor = at(buildFromPicker(at('/crew/c1/v/v1?voice=1'), 'ride'));
		expect(editor.pathname).toBe('/workouts/edit');
		const back = backFrom(editor)!;
		expect(back).toBe('/crew/c1/v/v1?voice=1&picker=ride');

		const door = takePickerDoor(at(withPick(back, 'w42')))!;
		expect(door).toMatchObject({ intent: 'ride', pick: 'w42' });
		expect(door.rest.pathname + door.rest.search).toBe('/crew/c1/v/v1?voice=1');
	});

	it('comes back without a pick from Discard', () => {
		const back = backFrom(at(buildFromPicker(at('/crew/c1/v/v1'), 'start')))!;
		expect(takePickerDoor(at(back))).toMatchObject({
			intent: 'start',
			pick: undefined,
		});
	});

	it('comes back on the road already chosen (#4224)', () => {
		const back = backFrom(
			at(buildFromPicker(at('/crew/c1/v/v1?road=old'), 'start', 'r7')),
		)!;
		expect(back).toBe('/crew/c1/v/v1?picker=start&road=r7');
		const door = takePickerDoor(at(withPick(back, 'w42')))!;
		expect(door).toMatchObject({ intent: 'start', pick: 'w42', road: 'r7' });
		expect(door.rest.pathname + door.rest.search).toBe('/crew/c1/v/v1');
	});

	it('opens nothing for an intent it does not know', () => {
		expect(takePickerDoor(at('/crew/c1/v/v1?picker=delete'))).toBeNull();
		expect(takePickerDoor(at('/crew/c1/v/v1'))).toBeNull();
	});

	it('never goes back to another site', () => {
		for (const back of [
			'https://evil.example/x',
			'//evil.example/x',
			'/\\evil.example/x',
			'javascript:alert(1)',
		]) {
			expect(
				backFrom(at(`/workouts/edit?back=${encodeURIComponent(back)}`)),
			).toBeNull();
		}
		expect(backFrom(at('/workouts/edit'))).toBeNull();
	});
});
