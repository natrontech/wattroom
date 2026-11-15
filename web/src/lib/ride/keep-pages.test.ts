import { describe, expect, it, vi } from 'vitest';

const preloaded = vi.hoisted(() => [] as string[]);
vi.mock('$app/navigation', () => ({
	preloadCode: async (id: string) => void preloaded.push(id),
}));

const { keepPages } = await import('./keep-pages');

// #4600: a deploy mid-ride turned the next link into a reload that ended the ride.
describe('keepPages', () => {
	it('fetches every page by its route id, once', () => {
		keepPages();
		keepPages();
		expect(preloaded).toContain('/(app)/ride');
		expect(preloaded).toContain('/(app)/history');
		expect(preloaded).toContain('/(app)/crew/[id]/v/[channel]/training');
		// A page that resets its layouts is the same route.
		expect(preloaded).toContain('/(app)/dev/perf');
		expect(new Set(preloaded).size).toBe(preloaded.length);
		for (const id of preloaded) expect(id).not.toMatch(/\+page/);
	});
});
