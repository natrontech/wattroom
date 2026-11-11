import { describe, expect, it } from 'vitest';
import { describeLongFrames, scriptName } from './long-frames';

describe('the long frames a fallback names', () => {
	it('names the longest first, three at most', () => {
		const line = describeLongFrames([
			{ at: 0, ms: 120, what: 'a' },
			{ at: 1, ms: 2310.4, what: 'b' },
			{ at: 2, ms: 480, what: 'c' },
			{ at: 3, ms: 90, what: 'd' },
		]);
		expect(line).toBe('2310 ms in b, 480 ms in c, 120 ms in a');
	});

	it('says so when nothing held the page', () => {
		expect(describeLongFrames([])).toBe('no long frames');
	});

	it('names a script by its function and file, without the query', () => {
		expect(
			scriptName({
				duration: 1,
				invoker: 'TimerHandler:setTimeout',
				sourceURL:
					'https://wattroom.ch/_app/immutable/chunks/RideWorld.Bx1.js?v=2',
				sourceFunctionName: 'generate',
			}),
		).toBe('generate (RideWorld.Bx1.js)');
		expect(scriptName({ duration: 1, invoker: 'FrameRequestCallback' })).toBe(
			'FrameRequestCallback',
		);
	});
});
