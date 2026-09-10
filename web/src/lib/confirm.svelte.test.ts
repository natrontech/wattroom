import { describe, expect, it } from 'vitest';
import { confirm, confirmation } from '$lib/confirm.svelte';

describe('confirm', () => {
	it('resolves to the button pressed and clears the question', async () => {
		const asked = confirm({
			title: 'Delete it?',
			action: 'Delete',
			cancel: 'Keep it',
		});
		expect(confirmation.current?.title).toBe('Delete it?');
		confirmation.settle(true);
		await expect(asked).resolves.toBe(true);
		expect(confirmation.current).toBeNull();

		const again = confirm({
			title: 'Again?',
			action: 'Yes',
			cancel: 'Keep it',
		});
		confirmation.settle(false);
		await expect(again).resolves.toBe(false);
	});

	it('a second question declines the first instead of stranding it', async () => {
		const first = confirm({ title: 'One', action: 'a', cancel: 'Keep it' });
		const second = confirm({ title: 'Two', action: 'b', cancel: 'Keep it' });
		await expect(first).resolves.toBe(false);
		expect(confirmation.current?.title).toBe('Two');
		confirmation.settle(true);
		await expect(second).resolves.toBe(true);
	});
});
