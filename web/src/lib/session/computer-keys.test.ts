// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { edgeDivider } from '$lib/divider';
import { code } from '$lib/source-scan.test-helper';
import { claimPageTurn } from './computer-pages';

/**
 * ← and → turn the bike computer's page, and nothing else does (ADR-0071):
 * PgUp/PgDn and the shift keys are Harder/Easier, Space is push-to-talk, a
 * pad's key is the soundboard's, and an arrow something else already took —
 * the pane divider, the interval graph's edit keys — is theirs.
 */
let heard: (1 | -1 | null)[] = [];
const listen = (event: KeyboardEvent) => heard.push(claimPageTurn(event));
window.addEventListener('keydown', listen);
afterEach(() => {
	heard = [];
	document.body.replaceChildren();
});

function press(init: KeyboardEventInit, on: EventTarget = window) {
	const event = new KeyboardEvent('keydown', {
		bubbles: true,
		cancelable: true,
		...init,
	});
	on.dispatchEvent(event);
	return event;
}

describe('the page keys', () => {
	it('turns on ← and →, and keeps the arrow from scrolling the page', () => {
		const right = press({ key: 'ArrowRight' });
		press({ key: 'ArrowLeft' });
		expect(heard).toEqual([1, -1]);
		expect(right.defaultPrevented).toBe(true);
	});

	it.each([
		['push-to-talk', { key: ' ', code: 'Space' }],
		['Harder', { key: 'PageUp' }],
		['Easier', { key: 'PageDown' }],
		['a shift key', { key: '.' }],
		['a shift key', { key: ',' }],
		['a shift key', { key: '+' }],
		['a shift key', { key: '-' }],
		['a shift key', { key: '=' }],
		['a pad', { key: 'b' }],
		['a pad', { key: '1' }],
		['the vertical arrows', { key: 'ArrowUp' }],
		['an arrow with a modifier', { key: 'ArrowRight', altKey: true }],
		['an arrow with a modifier', { key: 'ArrowRight', metaKey: true }],
		['an arrow with a modifier', { key: 'ArrowLeft', shiftKey: true }],
	])('leaves %s alone (%o)', (_, init) => {
		const event = press(init);
		expect(heard).toEqual([null]);
		expect(event.defaultPrevented).toBe(false);
	});

	it('leaves a rider typing alone', () => {
		const input = document.createElement('input');
		document.body.append(input);
		press({ key: 'ArrowRight' }, input);
		expect(heard).toEqual([null]);
	});

	it("leaves the pane divider's arrows to the divider", () => {
		const pane = document.createElement('aside');
		const grip = document.createElement('div');
		pane.append(grip);
		document.body.append(pane);
		const release = edgeDivider(grip);
		press({ key: 'ArrowRight' }, grip);
		press({ key: 'ArrowLeft' }, grip);
		expect(heard).toEqual([null, null]);
		release?.();
	});

	// The graph's edit keys run only in the editor, where no computer is
	// mounted; they take their arrows the way the divider does, and a handler
	// that has taken one is never overruled.
	it("leaves an arrow another control took to that control (the graph's edit keys)", () => {
		const block = document.createElement('div');
		block.addEventListener('keydown', (event) => event.preventDefault());
		document.body.append(block);
		press({ key: 'ArrowRight' }, block);
		expect(heard).toEqual([null]);

		const graph = code(
			readFileSync(
				join(import.meta.dirname, '../components/IntervalGraph.svelte'),
				'utf8',
			),
		);
		const editKeys = graph.slice(graph.indexOf('function editKeys'));
		const arrows = editKeys.slice(
			0,
			editKeys.indexOf("onEdit({ kind: 'seconds'"),
		);
		expect(arrows).toContain('event.preventDefault()');
	});

	it('turns every computer on the screen with one press, the desk’s and the TV’s', () => {
		const tv = (event: KeyboardEvent) => heard.push(claimPageTurn(event));
		window.addEventListener('keydown', tv);
		press({ key: 'ArrowRight' });
		window.removeEventListener('keydown', tv);
		expect(heard).toEqual([1, 1]);
	});
});
