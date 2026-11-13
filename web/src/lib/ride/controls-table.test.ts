import { describe, expect, it } from 'vitest';
import { OBC_BUTTONS } from '#lib/ble/obc.ts';
import { pressOfController, pressOfKey } from '#lib/ride/controller-test.ts';
import {
	clickButtons,
	controlsTable,
	keyEventOf,
	keystrokeMap,
} from './controls-table';

const press = (key: string) =>
	pressOfKey({
		key,
		code: '',
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
	});

// #4563: one table, and a Click V2 means one thing whichever way it connects.
describe('the Controllers table', () => {
	it('lists every action once', () => {
		const does = controlsTable().map((row) => row.does);
		expect(new Set(does).size).toBe(does.length);
		for (const action of Object.values(OBC_BUTTONS))
			expect(does).toContain(pressOfController(action));
	});

	it('puts each Click V2 button on the row network mode runs', () => {
		const table = controlsTable();
		for (const [button, action] of clickButtons())
			expect(
				table.find((r) => r.does === pressOfController(action))?.controller,
			).toContain(button);
	});

	it('gives keystroke mode the key for the same action', () => {
		const network = new Map(clickButtons());
		const keys = keystrokeMap();
		expect(keys.length).toBeGreaterThan(0);
		for (const [button, key] of keys)
			expect(press(keyEventOf(key)), `${button} → ${key}`).toBe(
				pressOfController(network.get(button)!),
			);
	});
});
