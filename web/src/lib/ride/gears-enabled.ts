import { canSimulate } from '$lib/ble/can-simulate';

/** An input that shifts (ADR-0084 "Inputs"). */
export type GearInput = 'screen' | 'keys' | 'phone' | 'obc' | 'obc-net';

/**
 * Each input's own switch: the on-screen pair, the keys (and anything that
 * types them: a clicker, a foot switch), the phone remote, an OpenBikeControl controller
 * over Web Bluetooth, and one over the network in the desktop shell. A grant
 * the patent watch reads (#3323) turns one off here and leaves the rest.
 */
export const GEAR_INPUTS: Readonly<Record<GearInput, boolean>> = {
	screen: true,
	keys: true,
	phone: true,
	obc: true,
	// Held at the dev gate (canSimulate's rule) until its switch-on, #3349.
	get 'obc-net'() {
		return canSimulate();
	},
};

/**
 * The input a shifter source belongs to: `screen:<dir>`, `key:<code>`,
 * `remote`, `obc:<action>`, `obc-net:<action>`. Any other source is no input, so a new one shifts nothing until
 * it has its own switch.
 */
export function inputOf(source: string): GearInput | null {
	if (source.startsWith('screen')) return 'screen';
	if (source.startsWith('key:')) return 'keys';
	if (source === 'remote') return 'phone';
	if (source.startsWith('obc:')) return 'obc';
	if (source.startsWith('obc-net:')) return 'obc-net';
	return null;
}

/**
 * May this screen shift virtual gears (ADR-0084)? Every rider may, since
 * the HUD, the keys, the ERG routing and the P1–P12 tests landed (#3333,
 * ADR-0088): from `input` while its switch is on, or from any input when
 * none is named. A source that is no input never shifts.
 */
export function gearsEnabled(
	input?: GearInput | null,
	inputs: Readonly<Record<GearInput, boolean>> = GEAR_INPUTS,
): boolean {
	if (input === null) return false;
	return input ? inputs[input] : Object.values(inputs).some(Boolean);
}
