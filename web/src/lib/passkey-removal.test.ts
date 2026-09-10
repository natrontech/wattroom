import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('$lib/confirm.svelte', () => ({ confirm: mocks.confirm }));
vi.mock('$lib/api', () => ({ api: vi.fn() }));

const { confirmRemoval, removeBody } = await import('./passkeys');

beforeEach(() => mocks.confirm.mockReset());

describe('removeBody', () => {
	// errors.md: what happens, why, what to do. The "why" a rider cannot guess
	// is that the authenticator cannot re-mint the same credential.
	it('says what stops, why it cannot come back, and what to do instead', () => {
		const body = removeBody('“Phone”');
		expect(body).toMatch(/^“Phone” stops signing you in/);
		expect(body).toMatch(/cannot re-create this same passkey/);
		expect(body).toMatch(/add a new one/);
	});

	// ADR-0029 keeps the account's last credential, so the copy promises it.
	it('says the other ways in survive', () => {
		expect(removeBody('“Phone”')).toMatch(/other ways in are untouched/);
	});
});

describe('confirmRemoval', () => {
	it('asks with the house pair and passes a refusal on (#1493)', async () => {
		mocks.confirm.mockResolvedValue(false);
		expect(await confirmRemoval({ name: 'YubiKey' })).toBe(false);
		const ask = mocks.confirm.mock.calls[0][0];
		expect(ask.title).toBe('Remove “YubiKey”?');
		expect(ask.action).toBe('Remove');
		expect(ask.cancel).toBe('Keep it');
		expect(ask.body).toBe(removeBody('“YubiKey”'));
	});

	it('passes a yes on', async () => {
		mocks.confirm.mockResolvedValue(true);
		expect(await confirmRemoval({ name: 'Phone' })).toBe(true);
	});
});
