import { describe, expect, it } from 'vitest';
import { sendsOnEnter } from './textarea';

describe('sendsOnEnter', () => {
	const key = (key: string, shiftKey = false, isComposing = false) => ({
		key,
		shiftKey,
		isComposing,
	});
	it('sends on a bare Enter at a desk', () => {
		expect(sendsOnEnter(key('Enter'), false)).toBe(true);
	});
	it('breaks the line on Shift+Enter, mid-composition, and on touch', () => {
		expect(sendsOnEnter(key('Enter', true), false)).toBe(false);
		expect(sendsOnEnter(key('Enter', false, true), false)).toBe(false);
		expect(sendsOnEnter(key('Enter'), true)).toBe(false);
	});
	it('ignores every other key', () => {
		expect(sendsOnEnter(key('a'), false)).toBe(false);
	});
});
