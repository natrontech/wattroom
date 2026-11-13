import { OBC_BUTTONS, type ObcAction } from '#lib/ble/obc.ts';
import { OBC_NAMES } from '#lib/ble/obc-legend.ts';
import { pressOfController } from '#lib/ride/controller-test.ts';
import { KEY_TABLE } from '#lib/ride/keys.ts';

/**
 * The Controllers page's one table (#4563): each thing WattRoom does, the
 * key that runs it and the Click V2 button that runs it over BikeControl's
 * network mode. Built from KEY_TABLE and OBC_BUTTONS, so neither can drift
 * from the page.
 */
export interface ControlRow {
	does: string;
	/** The keys, as the ? sheet writes them; empty where none runs it. */
	key: string;
	/** The Click V2's buttons; empty where it has none. */
	controller: string[];
	/** What a controller sends for it, by OpenBikeControl's name: the
	 *  column's words where the Click V2 has no button for it. */
	sends: string[];
}

/** Each Click V2 button and the action WattRoom runs for it. */
export function clickButtons(
	buttons: Readonly<Record<number, ObcAction>> = OBC_BUTTONS,
): [button: string, action: ObcAction][] {
	return Object.keys(buttons)
		.map(Number)
		.flatMap((id) => {
			const click = OBC_NAMES[id]?.click;
			return click ? [[click, buttons[id]] as [string, ObcAction]] : [];
		});
}

export function controlsTable(): ControlRow[] {
	const rows: ControlRow[] = KEY_TABLE.map(([key, does]) => ({
		does,
		key,
		controller: [],
		sends: [],
	}));
	const actions = new Set(Object.values(OBC_BUTTONS));
	for (const action of actions) {
		const does = pressOfController(action);
		if (!rows.some((row) => row.does === does))
			rows.push({ does, key: '', controller: [], sends: [] });
	}
	for (const [id, action] of Object.entries(OBC_BUTTONS)) {
		const row = rows.find((r) => r.does === pressOfController(action));
		const name = OBC_NAMES[Number(id)]?.action;
		if (row && name) row.sends.push(name);
	}
	for (const [button, action] of clickButtons()) {
		const row = rows.find((r) => r.does === pressOfController(action));
		if (row && !row.controller.includes(button)) row.controller.push(button);
	}
	return rows;
}

/**
 * Keystroke mode, the fallback (#4563): the key to give each Click V2
 * button in BikeControl, so it runs what network mode runs. The shift
 * buttons keep the Rouvy preset's , and .
 */
const KEY_OF: Record<ObcAction, string | null> = {
	harder: '.',
	easier: ',',
	'page-prev': '←',
	'page-next': '→',
	details: 'D',
	back: 'B',
	'next-view': 'N',
	map: 'M',
	clean: 'H',
	snap: 'O',
	camera: null,
	talk: null,
};

export function keystrokeMap(): [button: string, key: string][] {
	return clickButtons().flatMap(([button, action]) => {
		const key = KEY_OF[action];
		return key ? [[button, key] as [string, string]] : [];
	});
}

/** The `key` a keystroke-mode key arrives as. */
export const keyEventOf = (key: string): string =>
	({ '←': 'ArrowLeft', '→': 'ArrowRight' })[key] ?? key.toLowerCase();
