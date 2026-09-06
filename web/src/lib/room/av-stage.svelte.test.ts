// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createStage } from '$lib/room/av-stage.svelte';

describe('the stage', () => {
	it('keeps every share, newest last (#280)', () => {
		const stage = createStage();
		stage.addScreen('alice');
		stage.addScreen('bob');
		// #206's projector kept exactly one — a second sharer silently stole
		// the room's screen.
		expect(stage.sources.map((s) => s.key)).toEqual([
			'screen:alice',
			'screen:bob',
		]);
	});

	it('re-sharing moves you to newest rather than duplicating you', () => {
		const stage = createStage();
		stage.addScreen('alice');
		stage.addScreen('bob');
		stage.addScreen('alice');
		expect(stage.sources.map((s) => s.key)).toEqual([
			'screen:bob',
			'screen:alice',
		]);
	});

	it('puts screens before cameras — a share is why anyone looks', () => {
		const stage = createStage();
		stage.bumpVideo('cara');
		stage.addScreen('alice');
		expect(stage.sources.map((s) => s.kind)).toEqual(['screen', 'cam']);
	});

	it('releases the stage when the share you pinned stops (#206)', () => {
		const stage = createStage();
		stage.addScreen('alice');
		stage.addScreen('bob');
		stage.setPick('screen:alice');
		stage.dropScreen('alice');
		// null, not the dead key: the viewer follows the newest share again
		// rather than staring at a blank stage.
		expect(stage.pick).toBeNull();
	});

	it('leaves your pick alone when someone else stops sharing', () => {
		const stage = createStage();
		stage.addScreen('alice');
		stage.addScreen('bob');
		stage.setPick('screen:alice');
		stage.dropScreen('bob');
		expect(stage.pick).toBe('screen:alice');
	});

	it('a camera turning off clears the flag, not just bumps it (#219)', () => {
		const stage = createStage();
		stage.bumpVideo('cara');
		expect(stage.hasVideo('cara')).toBe(true);
		stage.dropVideo('cara');
		// Bumping on the way out left a blank tile claiming "camera on" for
		// the rest of the session.
		expect(stage.hasVideo('cara')).toBe(false);
		expect(stage.sources).toEqual([]);
	});

	it('bumps the generation so a re-attach is retriggered', () => {
		const stage = createStage();
		stage.bumpVideo('cara');
		const first = stage.sources[0].gen;
		stage.bumpVideo('cara');
		expect(stage.sources[0].gen).toBeGreaterThan(first);
	});

	it('clears everything on leave', () => {
		const stage = createStage();
		stage.addScreen('alice');
		stage.bumpVideo('cara');
		stage.setPick('cam:cara');
		stage.clear();
		expect(stage.sources).toEqual([]);
		expect(stage.pick).toBeNull();
	});
});
