import { describe, expect, it } from 'vitest';
import { cardView } from './sensor-card';

/**
 * The state→render mapping for every state one card can be in (#1000).
 * The rule under every case: never a control that would fail, always a reason.
 */
describe('cardView', () => {
	it('offers pairing when idle', () => {
		const view = cardView({ state: 'idle', supported: true });
		expect(view).toMatchObject({
			shape: 'note',
			note: 'Not connected',
			button: { label: 'Pair' },
		});
	});

	it('presses nothing while connecting', () => {
		const view = cardView({ state: 'connecting', supported: true });
		expect(view.note).toBe('Connecting…');
		expect(view.button).toBeUndefined();
	});

	it('gives a reconnecting device a way out, not just a spinner (#1716)', () => {
		const view = cardView({ state: 'reconnecting', supported: true });
		expect(view).toMatchObject({
			note: 'Reconnecting…',
			tone: 'danger',
			// A strap whose battery died retries every thirty seconds forever;
			// without this there was nothing on the card to press.
			button: { label: 'Forget', variant: 'forget' },
		});
	});

	it('keeps a reconnecting device this screen’s, whatever another claims', () => {
		const view = cardView({
			state: 'reconnecting',
			supported: true,
			elsewhere: 'on your phone',
		});
		expect(view.note).toBe('Reconnecting…');
		expect(view.instead).toBeUndefined();
	});

	it('goes live once connected', () => {
		const view = cardView({ state: 'connected', supported: true });
		expect(view.shape).toBe('live');
		expect(view.button).toMatchObject({ variant: 'forget' });
	});

	it('offers a retry after a failure, in the danger tone', () => {
		const view = cardView({ state: 'failed', supported: true });
		expect(view).toMatchObject({
			tone: 'danger',
			button: { label: 'Retry' },
		});
	});

	it('says paired-but-silent without leaving the live shape (#520)', () => {
		const view = cardView({
			state: 'connected',
			supported: true,
			hint: 'no watts yet — turn the cranks',
		});
		// Still live — it IS paired — but the fault is what carries the colour.
		expect(view.shape).toBe('live');
		expect(view.tone).toBe('danger');
		expect(view.note).toBe('no watts yet — turn the cranks');
	});

	it('names the screen holding it instead of a button (#610)', () => {
		const view = cardView({
			state: 'idle',
			supported: true,
			elsewhere: 'on your phone',
		});
		expect(view.note).toBe('Paired on your phone');
		expect(view.button).toBeUndefined();
		expect(view.instead).toBe('Forget it there to move it');
	});

	it('explains a browser with no Web Bluetooth rather than disabling a button', () => {
		const view = cardView({ state: 'idle', supported: false });
		expect(view.button).toBeUndefined();
		expect(view.instead).toBe('Needs Chrome or Edge');
	});

	it('shows this screen its own trainer even when another screen claims it', () => {
		// The claim is stale or the hub moved it back: watts arriving here beat
		// a phrase about somewhere else.
		const view = cardView({
			state: 'connected',
			supported: true,
			elsewhere: 'on your phone',
		});
		expect(view.shape).toBe('live');
	});
});
