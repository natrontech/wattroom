// The release gate runs this harness against wattroom.ch from a container that
// mounts web/ alone, so scripts/dev-env.sh is not reachable from inside it.
// env.js used to read that script at import, which made Playwright die loading
// its config: the ride never rode, the gate read that as a failed ride, and a
// healthy 2026.09.113 was rolled back and blacklisted (#2126).
//
// So the invariant under test is not "the ports are right" — it is that a run
// aimed at a deployed target never shells out at all.
import { beforeEach, expect, it, vi } from 'vitest';

const execFileSync = vi.fn();
vi.mock('node:child_process', () => ({
	execFileSync: (...args: unknown[]) => execFileSync(...args),
}));

beforeEach(() => {
	// env.js reads PLAYWRIGHT_BASE_URL once, at import, so each case needs its
	// own instance of the module.
	vi.resetModules();
	execFileSync.mockReset();
	vi.unstubAllEnvs();
});

it('never runs dev-env.sh when the suite rides a deployed target', async () => {
	vi.stubEnv('PLAYWRIGHT_BASE_URL', 'https://wattroom.ch');

	const env = await import('./env.js');

	expect(env.isExternal()).toBe(true);
	expect(env.baseUrl()).toBe('https://wattroom.ch');
	expect(execFileSync).not.toHaveBeenCalled();
});

it("derives this checkout's port when there is no deployed target", async () => {
	vi.stubEnv('PLAYWRIGHT_BASE_URL', '');
	execFileSync.mockReturnValue(
		"export WATTROOM_E2E_WEB_PORT='4413'\nexport WATTROOM_E2E_API_PORT='8713'\n",
	);

	const env = await import('./env.js');

	expect(env.isExternal()).toBe(false);
	expect(env.baseUrl()).toBe('http://localhost:4413');
	expect(env.apiPort()).toBe(8713);
	// Derived once and reused, not re-read per accessor.
	expect(execFileSync).toHaveBeenCalledOnce();
});

it('refuses a port the script did not give, rather than defaulting one', async () => {
	vi.stubEnv('PLAYWRIGHT_BASE_URL', '');
	execFileSync.mockReturnValue("export WATTROOM_WORKTREE='main'\n");

	const env = await import('./env.js');

	// `server.listen(NaN)` binds a random free port quite happily, and the
	// readiness probe then waits two minutes on the port it was told about.
	expect(() => env.webPort()).toThrow(/WATTROOM_E2E_WEB_PORT/);
});
