import { beforeEach, describe, expect, it } from 'vitest';
import { boardPanel } from '$lib/board/panel.svelte';
import { modals } from '$lib/modals.svelte';

describe('the board panel’s three faces', () => {
	beforeEach(() => boardPanel.hide());

	it('opens on the pads, whatever face it was left on', () => {
		boardPanel.show();
		boardPanel.trim('clip-1');
		expect(boardPanel.face).toBe('trim');
		boardPanel.hide();
		boardPanel.show();
		// Reopening onto a half-finished trim of a clip the rider stopped
		// thinking about is where they abandoned something, not where they
		// left off.
		expect(boardPanel.face).toBe('board');
		expect(boardPanel.trimming).toBeNull();
	});

	it('walks back one step at a time — trim came from the clips face', () => {
		boardPanel.show();
		boardPanel.go('clips');
		boardPanel.trim('clip-1');
		boardPanel.back();
		expect(boardPanel.face).toBe('clips');
		expect(boardPanel.trimming).toBeNull();
		boardPanel.back();
		expect(boardPanel.face).toBe('board');
	});

	it('will not show a trim face with nothing to trim', () => {
		boardPanel.show();
		boardPanel.go('trim');
		expect(boardPanel.face).toBe('board');
	});

	it('drops the clip on the way out of the trim face', () => {
		boardPanel.show();
		boardPanel.trim('clip-1');
		boardPanel.go('board');
		expect(boardPanel.trimming).toBeNull();
	});

	// The whole point of #981: the library and the trim editor were `<Modal>`s
	// opened from the board, so the board counted its own children and dimmed
	// itself out of the way of the thing it had just opened.
	it('never counts as a modal, on any face', () => {
		expect(modals.open).toBe(0);
		boardPanel.show();
		boardPanel.go('clips');
		expect(modals.open).toBe(0);
		boardPanel.trim('clip-1');
		expect(modals.open).toBe(0);
		boardPanel.back();
		boardPanel.back();
		expect(modals.open).toBe(0);
	});

	it('toggles closed from any face', () => {
		boardPanel.show();
		boardPanel.trim('clip-1');
		boardPanel.toggle();
		expect(boardPanel.open).toBe(false);
		boardPanel.toggle();
		expect(boardPanel.open).toBe(true);
		expect(boardPanel.face).toBe('board');
	});
});
