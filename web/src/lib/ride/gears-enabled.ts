import { canSimulate } from '$lib/ble/can-simulate';

/**
 * May this screen shift virtual gears (ADR-0084)? One rule, in one place:
 * canSimulate()'s dev-only gate until "gears reach riders" (#3333) lifts it,
 * after the gears hardware session (#3350) and the HUD, keys and ERG pieces.
 */
export function gearsEnabled(): boolean {
	return canSimulate();
}
