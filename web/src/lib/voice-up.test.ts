import { describe, expect, it } from 'vitest';
import { voiceUp, type Me } from '$lib/account.svelte';

// Configured is not up (#2850): a Join voice that can only fail is a button
// errors.md says not to draw. An older server sends no avReachable, which
// reads as up — as it always did.
describe('voiceUp', () => {
	const me = (fields: Partial<Me>) => fields as Me;
	it.each([
		[
			'configured and answering',
			me({ avEnabled: true, avReachable: true }),
			true,
		],
		['configured, down', me({ avEnabled: true, avReachable: false }), false],
		['configured, an older server', me({ avEnabled: true }), true],
		['not configured', me({ avEnabled: false, avReachable: true }), false],
		['signed out', null, false],
	])('%s', (_, account, up) => {
		expect(voiceUp(account)).toBe(up);
	});
});
