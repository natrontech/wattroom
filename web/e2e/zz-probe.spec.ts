import { expect, test } from '@playwright/test';

// Throwaway: shows the e2e check going red when a shard fails.
test('a probe that fails', () => {
	expect(1).toBe(2);
});
