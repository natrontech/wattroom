import { describe, expect, it } from 'vitest';
import type { Me } from '$lib/account.svelte';
import { canSkipEmailPrompt, shouldPromptEmail } from './verify-prompt';

const me = (over: Partial<Me> = {}): Me =>
	({
		id: 'u1',
		displayName: 'Rider',
		ftpWatts: 200,
		weightKg: 75,
		mailAvailable: true,
		emailVerified: false,
		emailRequired: false,
		...over,
	}) as Me;

describe('shouldPromptEmail', () => {
	it('says nothing on a server that cannot send', () => {
		expect(shouldPromptEmail(me({ mailAvailable: false }), false)).toBe(false);
		// Even for an account that must verify — the flow could not finish.
		expect(
			shouldPromptEmail(
				me({ mailAvailable: false, emailRequired: true }),
				false,
			),
		).toBe(false);
	});

	it('stops once the address is confirmed', () => {
		expect(
			shouldPromptEmail(
				me({ emailVerified: true, emailRequired: true }),
				false,
			),
		).toBe(false);
	});

	it('comes back for a required account that dismissed it', () => {
		expect(shouldPromptEmail(me({ emailRequired: true }), true)).toBe(true);
	});

	it('honours Later for an account that predates the requirement', () => {
		expect(shouldPromptEmail(me(), false)).toBe(true);
		expect(shouldPromptEmail(me(), true)).toBe(false);
	});

	it('offers Later only where the address is not required', () => {
		expect(canSkipEmailPrompt(me())).toBe(true);
		expect(canSkipEmailPrompt(me({ emailRequired: true }))).toBe(false);
	});

	it('shows nothing while the account is still loading', () => {
		expect(shouldPromptEmail(null, false)).toBe(false);
	});

	// The ride monitor drives the same SPA a rider does, and a gate in front of
	// it fails the release's own rollout check (#822).
	it('never asks the machine account', () => {
		expect(
			shouldPromptEmail(
				me({ providers: ['synthetic'], emailRequired: true }),
				false,
			),
		).toBe(false);
	});

	// Only when synthetic is the *whole* story: a rider who somehow carries it
	// alongside a real provider is still a rider.
	it('still asks an account that has a real provider too', () => {
		expect(
			shouldPromptEmail(me({ providers: ['synthetic', 'github'] }), false),
		).toBe(true);
	});
});
