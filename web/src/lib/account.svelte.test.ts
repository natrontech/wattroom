// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '$lib/api';

/**
 * #850, a rider report: clicking through Home and settings, they dropped out
 * of the room they were in without a sound and did not notice. `load()` read
 * every failed `GET /api/me` as "signed out", and the layout's sign-out effect
 * closes the socket, hangs up voice and releases the trainer.
 *
 * `load()` is not a startup call — Home, the room layout, the landing page and
 * the verify-email gate all make it, the last on every `visibilitychange` — so
 * one unlucky response out of a whole click-around took the room down.
 */
const answers = new Map<string, ApiResult<unknown>>();
const calls: string[] = [];
let hold: (() => void) | null = null;

vi.mock('$lib/api', () => ({
	api: async (path: string) => {
		calls.push(path);
		// Read now, answer later: a held call carries what it was given when it
		// left, the way a real request in flight does.
		const answer = answers.get(path) ?? { ok: true, data: {} };
		if (hold && path === '/api/me')
			await new Promise<void>((go) => (hold = go));
		return answer;
	},
}));
vi.mock('$lib/people.svelte', () => ({ people: { learn: () => {} } }));

const { account } = await import('$lib/account.svelte');

const ME = { id: 'u1', displayName: 'Jan', ftpWatts: 240, weightKg: 72 };
const signedIn = () => answers.set('/api/me', { ok: true, data: ME });
const fails = (error: string) =>
	answers.set('/api/me', { ok: false, error: { error, message: 'no' } });

describe('account.load', () => {
	beforeEach(async () => {
		answers.clear();
		calls.length = 0;
		hold = null;
		signedIn();
		await account.load();
		expect(account.me?.id).toBe('u1');
	});

	// The one answer that means signed out.
	it('signs the rider out when the server says unauthorized', async () => {
		fails('unauthorized');
		await account.load();
		expect(account.me).toBe(null);
		expect(account.loaded).toBe(true);
	});

	// Everything else is a question that failed, not an answer about identity.
	it.each([
		['an unreachable server', 'network'],
		['a session lookup that hit a database blip', 'internal_error'],
	])('keeps the rider signed in through %s', async (_what, error) => {
		fails(error);
		await account.load();
		expect(account.me?.id).toBe('u1');
	});

	// A failed providers call must not empty a list the login page draws from.
	it('keeps the known providers when the server is unreachable', async () => {
		answers.set('/api/auth/providers', {
			ok: true,
			data: { providers: ['github'] },
		});
		await account.load();
		expect(account.providers).toEqual(['github']);

		answers.set('/api/auth/providers', {
			ok: false,
			error: { error: 'network', message: 'no' },
		});
		await account.load();
		expect(account.providers).toEqual(['github']);
	});

	// Clicking around puts several loads in flight at once; the slow one used
	// to be able to answer last and overwrite a fresher truth.
	it('lets the newest load win, whatever order they answer in', async () => {
		hold = () => {};
		fails('unauthorized');
		const slow = account.load();
		const release = hold!;
		signedIn();
		hold = null;
		await account.load();
		expect(account.me?.id).toBe('u1');

		release();
		await slow;
		expect(account.me?.id).toBe('u1');
	});
});

/**
 * #858: session email used to name times in the server's zone. The browser is
 * the only thing that knows the rider's, so it reports it — on load, so it
 * also corrects itself when they move, and quietly, because a timezone picker
 * would fail the 95% rule.
 */
describe('account.load timezone', () => {
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const writes = () => calls.filter((c) => c === '/api/me/timezone').length;

	beforeEach(() => {
		answers.clear();
		calls.length = 0;
		hold = null;
		signedIn();
	});

	it('reports the zone once the server does not know it', async () => {
		await account.load();
		expect(writes()).toBe(1);
		expect(account.me?.timezone).toBe(zone);
	});

	it('stays quiet once the server has it', async () => {
		// What a real server answers after the first write.
		answers.set('/api/me', { ok: true, data: { ...ME, timezone: zone } });
		await account.load();
		expect(writes()).toBe(0);

		// load() runs on every visibilitychange; clicking around must not turn
		// into a write per click.
		await account.load();
		await account.load();
		expect(writes()).toBe(0);
	});
});
