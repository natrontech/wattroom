import { describe, expect, it } from 'vitest';
import { nameFromFile } from '$lib/board/clips.svelte';

describe('nameFromFile', () => {
	it('drops the extension and shouts, because a pad is read at arm’s length', () => {
		expect(nameFromFile('airhorn.mp3')).toBe('AIRHORN');
		expect(nameFromFile('cowbell-hit.MP3')).toBe('COWBELL-HIT');
	});

	it('keeps a name inside what the server accepts', () => {
		expect(nameFromFile(`${'a'.repeat(80)}.mp3`)).toHaveLength(32);
	});

	it('only drops the last extension', () => {
		expect(nameFromFile('sprint.count.mp3')).toBe('SPRINT.COUNT');
	});

	it('never hands the server an empty name', () => {
		expect(nameFromFile('.mp3')).toBe('CLIP');
		expect(nameFromFile('   ')).toBe('CLIP');
	});
});
