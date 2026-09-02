import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The room's stacking order (#483). The jukebox player is ONE fixed box that
 * flies to whatever seat the room offers, so its layer is not a component's
 * private business: it decides what the rider can still reach while a video
 * is on the stage. Below xl the side panel is a sheet, and a sheet drawn
 * UNDER the player left a laptop-width room with no transport, no people and
 * no chat — the video sat on all three.
 *
 * The rule, from the dock's own comment: RMF forbids OUR chrome over the
 * player, never a surface the rider pulled open. So the seated player clears
 * the stage it sits in, and anything the rider opens clears the player.
 */
const SRC = join(import.meta.dirname, '..', '..');

function layer(file: string, pattern: RegExp): number {
	const source = readFileSync(join(SRC, file), 'utf8');
	const matches = [...source.matchAll(new RegExp(pattern, 'g'))];
	// One match, or the anchor has drifted and the number below means nothing.
	expect(matches, `${file} ${pattern}`).toHaveLength(1);
	return Number(matches[0][1]);
}

describe('room stacking (#483)', () => {
	const seatedPlayer = layer('lib/room/JukeboxDock.svelte', /\? 'z-\[(\d+)\]'/);
	const floatingPlayer = layer('lib/room/JukeboxDock.svelte', /: 'z-(\d+)'/);
	const poppedStage = layer(
		'lib/room/Stage.svelte',
		/fixed top-24 left-24 z-\[(\d+)\]/,
	);
	const tvMode = layer(
		'lib/room/RoomShell.svelte',
		/cave bg-surface fixed inset-0 z-(\d+)/,
	);
	const chatSheet = layer(
		'lib/room/RoomShell.svelte',
		/bg-paper\/50 fixed inset-0 z-\[(\d+)\] xl:hidden/,
	);

	it('draws the seated player inside the surfaces that seat it', () => {
		// It flies into a hole in these, so it has to be above them or the
		// picture is behind the thing offering the seat.
		expect(seatedPlayer).toBeGreaterThan(poppedStage);
		expect(seatedPlayer).toBeGreaterThan(tvMode);
	});

	it('lets the sheet the rider opened cover the seated player', () => {
		// Below xl this sheet is the only jukebox transport there is.
		expect(chatSheet).toBeGreaterThan(seatedPlayer);
	});

	it('keeps the floating player under every overlay', () => {
		// Cornered, it is chrome like any other and yields to dialogs.
		expect(floatingPlayer).toBeLessThan(tvMode);
		expect(floatingPlayer).toBeLessThan(poppedStage);
	});
});
