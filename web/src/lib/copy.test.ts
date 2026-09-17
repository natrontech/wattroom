// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '$lib/copy';

const shown = vi.hoisted(() => ({
	said: [] as { text: string; tone?: string }[],
}));
vi.mock('$lib/toast.svelte', () => ({
	toasts: {
		push: (text: string, opts?: { tone?: string }) =>
			shown.said.push({ text, tone: opts?.tone }),
	},
}));

function clipboard(writeText: () => Promise<void>) {
	Object.defineProperty(navigator, 'clipboard', {
		value: { writeText },
		configurable: true,
	});
}

beforeEach(() => {
	shown.said = [];
});

describe('copyText (#2182)', () => {
	it('says it copied only once it has', async () => {
		clipboard(() => Promise.resolve());
		await copyText('ABCD12', 'Friend code copied.');
		expect(shown.said).toEqual([
			{ text: 'Friend code copied.', tone: undefined },
		]);
	});

	it('says a refused copy did not happen', async () => {
		// The paste is where a silent failure is discovered, and nothing there
		// explains it (errors.md).
		clipboard(() => Promise.reject(new Error('NotAllowedError')));
		await copyText('ABCD12', 'Friend code copied.');
		expect(shown.said).toEqual([
			{ text: 'Copy needs clipboard permission.', tone: 'error' },
		]);
	});
});
