import { OBC_BUTTONS, type ObcAction } from './obc';

/**
 * The Controllers page's legend (#4547): what each OpenBikeControl action
 * WattRoom answers does here, and the button that usually sends it. Built
 * from OBC_BUTTONS, so an ID added there without a name here fails its
 * test rather than going missing from the page.
 */

/**
 * Each answered ID's action as PROTOCOL.md names it, and the Zwift Click
 * V2's button for it under BikeControl's defaults (#4532), where it has one.
 */
export const OBC_NAMES: Readonly<
	Record<number, { action: string; click?: string }>
> = {
	0x01: { action: 'Shift Up', click: '+' },
	0x02: { action: 'Shift Down', click: '−' },
	0x10: { action: 'Up', click: '↑' },
	0x11: { action: 'Down', click: '↓' },
	0x12: { action: 'Left' },
	0x13: { action: 'Right' },
	0x14: { action: 'Select', click: 'A' },
	0x15: { action: 'Back', click: 'B' },
	0x16: { action: 'Menu', click: 'Y' },
	0x18: { action: 'Steer Left', click: '←' },
	0x19: { action: 'Steer Right', click: '→' },
	0x21: { action: 'Push to Talk' },
	0x24: { action: 'Screenshot' },
	0x30: { action: 'Increase Difficulty' },
	0x31: { action: 'Decrease Difficulty' },
	0x40: { action: 'Camera View' },
	0x44: { action: 'HUD Toggle' },
	0x45: { action: 'Map Toggle' },
};

/** What each action does in WattRoom, in the legend's order. */
const DOES: Record<ObcAction, string> = {
	harder: 'Harder',
	easier: 'Easier',
	'page-prev': 'Previous computer page',
	'page-next': 'Next computer page',
	details: 'Ride details, open or shut',
	back: 'Back to RIDE',
	'next-view': 'Next view: 3D, Flat, Map, Lounge',
	talk: 'Talk, while held',
	camera: 'Next camera',
	map: 'Map page, and back',
	clean: 'Clean view',
	snap: 'Snapshot',
};

export interface LegendRow {
	action: ObcAction;
	does: string;
	/** The OBC actions that run it, as PROTOCOL.md names them. */
	sends: string[];
	/** The Click V2's buttons for them; empty where it has none. */
	click: string[];
}

export function obcLegend(
	buttons: Readonly<Record<number, ObcAction>> = OBC_BUTTONS,
): LegendRow[] {
	const ids = Object.keys(buttons).map(Number);
	return (Object.keys(DOES) as ObcAction[])
		.map((action) => {
			const names = ids
				.filter((id) => buttons[id] === action)
				.map((id) => OBC_NAMES[id]);
			return {
				action,
				does: DOES[action],
				sends: names.map((n) => n.action),
				click: names.flatMap((n) => (n.click ? [n.click] : [])),
			};
		})
		.filter((row) => row.sends.length > 0);
}
