import { describe, expect, it } from 'vitest';
import {
	trackFailureIsGlobal,
	youtubeFailureIsGlobal,
} from './playback-failure';

describe('whose playback failure it is (#1896)', () => {
	it("ends the room's play only for what nobody can play", () => {
		for (const code of [2, 100, 101, 150])
			expect(youtubeFailureIsGlobal(code)).toBe(true);
		for (const code of [5, 0, 42])
			expect(youtubeFailureIsGlobal(code)).toBe(false);
	});
	it('treats a track that is gone as gone for everyone, and nothing else', () => {
		expect(trackFailureIsGlobal(404)).toBe(true);
		expect(trackFailureIsGlobal(410)).toBe(true);
		for (const status of [200, 206, 500, 502, 0])
			expect(trackFailureIsGlobal(status)).toBe(false);
	});
});
