import { dev } from '$app/environment';
import { account } from '$lib/account.svelte';

/**
 * May this screen offer a simulated trainer (#123)?
 *
 * One rule, because simulated watts reach medals, XP and streaks — a fairness
 * rule with four implementations was one rule and three bugs (#1000). It used
 * to be `dev` on /ramp, `dev || ?sim=1` on /ride (a URL any rider could type),
 * `dev || the dev door` in the room, and nothing at all on /pair.
 *
 * The room's rule wins because it is the strict one and it survives a
 * production BUILD, where `dev` is false: a server that offers the dev
 * sign-in door (WATTROOM_DEV_LOGIN) is a dev server, and production never
 * opens that door. That is what admits CI's e2e without an escape hatch.
 *
 * The synthetic monitor is the one exception, and it is an identity rather
 * than a door: production offers no dev sign-in, but #153's pre-deploy ride
 * has to be simulated — there is no trainer in a datacentre. It is never
 * listed as a provider anyone can sign in through (auth_test.go asserts it),
 * so this cannot become a rider's escape hatch.
 */
export function canSimulate(): boolean {
	return (
		dev ||
		account.providers.includes('dev') ||
		!!account.me?.providers?.includes('synthetic')
	);
}
