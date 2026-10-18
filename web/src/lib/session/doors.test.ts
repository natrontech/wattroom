import { describe, expect, it } from 'vitest';
import {
	backFrom,
	buildFromPicker,
	gameDoor,
	takeGameDoor,
	takePickerDoor,
	withPick,
} from './doors';

const at = (path: string) => new URL(path, 'http://x');

describe('the game door (#3276)', () => {
	it('carries one mode to the lounge, and comes off the address once taken', () => {
		const href = gameDoor('/crew/c1/v/v1', 'watt-golf');
		expect(href).toBe('/crew/c1/v/v1?game=watt-golf');
		const door = takeGameDoor(at(href + '&voice=1'))!;
		expect(door.mode).toBe('watt-golf');
		expect(door.rest.pathname + door.rest.search).toBe('/crew/c1/v/v1?voice=1');
		expect(takeGameDoor(at('/crew/c1/v/v1'))).toBeNull();
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
