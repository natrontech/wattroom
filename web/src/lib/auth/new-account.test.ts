import { beforeEach, describe, expect, it } from 'vitest';
import { noteNewAccount, takeNewAccount } from './new-account';

describe('new account flag', () => {
	beforeEach(() => void takeNewAccount());

	it('is nothing for an ordinary sign-in', () => {
		noteNewAccount('');
		expect(takeNewAccount()).toBeNull();
	});

	it('catches the provider before routing drops it', () => {
		noteNewAccount('?new=github');
		expect(takeNewAccount()).toBe('github');
	});

	it('is a one-time thing', () => {
		noteNewAccount('?new=strava');
		expect(takeNewAccount()).toBe('strava');
		expect(takeNewAccount()).toBeNull();
	});

	it('keeps the first sighting — later routing must not clear it', () => {
		noteNewAccount('?new=google');
		noteNewAccount('');
		expect(takeNewAccount()).toBe('google');
	});
});
