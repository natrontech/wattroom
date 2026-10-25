/**
 * OpenBikeControl's messages (protocol v1, MIT:
 * github.com/OpenBikeControl/openbikecontrol-protocol, PROTOCOL.md and
 * BLE.md), read for the spec only. Pure and transport-free: the same bytes
 * arrive over Web Bluetooth here and over TCP in the desktop shell (MDNS.md),
 * so both decode with this module.
 *
 * WattRoom sends the controller the button IDs it answers (App Information)
 * and never reads a bitmap of the controller's inputs (ADR-0084, the
 * 19/234,077 re-check).
 */

export const OBC = {
	service: 'd273f680-d548-419d-b9d1-fa0472345229',
	buttonState: 'd273f681-d548-419d-b9d1-fa0472345229',
	haptic: 'd273f682-d548-419d-b9d1-fa0472345229',
	appInfo: 'd273f683-d548-419d-b9d1-fa0472345229',
} as const;

/** What a controller's button does in WattRoom. */
export type ObcAction =
	| 'harder'
	| 'easier'
	| 'talk'
	| 'camera'
	| 'clean'
	| 'map'
	| 'snap'
	| 'page-prev'
	| 'page-next';

/**
 * The buttons WattRoom answers, and exactly the list App Information sends
 * (#3335). Gear Set (0x03) is not among them: a gear moves to its table
 * neighbour only, and with no real ratio known it has no index to set
 * (ADR-0084).
 */
export const OBC_BUTTONS: Readonly<Record<number, ObcAction>> = {
	0x01: 'harder', // Shift Up
	0x02: 'easier', // Shift Down
	0x30: 'harder', // Increase Difficulty
	0x31: 'easier', // Decrease Difficulty
	0x21: 'talk', // Push to Talk, held
	0x24: 'snap', // Screenshot
	0x40: 'camera', // Camera View, cycled
	0x44: 'clean', // HUD Toggle
	0x45: 'map', // Map Toggle
	0x12: 'page-prev', // Left
	0x13: 'page-next', // Right
};

export interface ObcButton {
	id: number;
	/** 0x00 released, 0x01 pressed, 0x02–0xFF an analog value. */
	state: number;
}

export type ObcMessage =
	| { type: 'buttons'; buttons: ObcButton[] }
	| { type: 'status'; battery: number | null; connected: boolean };

/**
 * One message from a controller: Button State (0x01: id, state pairs) or,
 * over the network, Device Status (0x02). Anything else, or a frame cut
 * short, is null.
 */
export function decodeObc(bytes: Uint8Array): ObcMessage | null {
	if (bytes[0] === 0x01) {
		if (bytes.length < 3 || bytes.length % 2 === 0) return null;
		const buttons: ObcButton[] = [];
		for (let i = 1; i < bytes.length; i += 2)
			buttons.push({ id: bytes[i], state: bytes[i + 1] });
		return { type: 'buttons', buttons };
	}
	if (bytes[0] === 0x02 && bytes.length >= 3)
		return {
			type: 'status',
			battery: bytes[1] <= 100 ? bytes[1] : null,
			connected: bytes[2] === 0x01,
		};
	return null;
}

const utf8 = (text: string) => new TextEncoder().encode(text).slice(0, 32);

/** App Information (0x04, format 1): who WattRoom is and which buttons it answers. */
export function encodeAppInfo(
	appId: string,
	version: string,
	buttons: readonly number[],
): Uint8Array<ArrayBuffer> {
	const id = utf8(appId);
	const ver = utf8(version);
	return Uint8Array.of(
		0x04,
		0x01,
		id.length,
		...id,
		ver.length,
		...ver,
		buttons.length,
		...buttons,
	);
}

/** WattRoom's App Information: its id and every button in OBC_BUTTONS. */
export const WATTROOM_APP_INFO = encodeAppInfo(
	'wattroom',
	'',
	Object.keys(OBC_BUTTONS).map(Number),
);

/** A gear moved, or a press at an end of the cassette (ADR-0084 rule 2). */
export type ObcFeel = 'shift' | 'end';

/**
 * Haptic Feedback (0x03): a single short vibration for a shift, the
 * warning's two short pulses at an end; default duration and intensity.
 */
export function encodeHaptic(feel: ObcFeel): Uint8Array<ArrayBuffer> {
	return Uint8Array.of(0x03, feel === 'shift' ? 0x01 : 0x06, 0x00, 0x00);
}

/** A button's edge: pressed, released, or let go because the link went. */
export type ObcEdge = 'down' | 'up' | 'drop';

/**
 * Button states into action edges. One physical button may send several IDs
 * at once (Shift Up and Increase Difficulty, PROTOCOL.md "Multiple Actions
 * Per Button"), so an action goes down with the first of its IDs and up with
 * the last: one press, never two shifts.
 */
export function createObcButtons(
	onEdge: (action: ObcAction, edge: ObcEdge) => void,
) {
	const pressed = new Map<ObcAction, Set<number>>();
	return {
		/** One decoded message; device status and unknown buttons change nothing. */
		take(message: ObcMessage | null) {
			if (message?.type !== 'buttons') return;
			for (const { id, state } of message.buttons) {
				const action = OBC_BUTTONS[id];
				if (!action) continue;
				const ids = pressed.get(action) ?? new Set<number>();
				const was = ids.size > 0;
				if (state === 0x00) ids.delete(id);
				else ids.add(id);
				pressed.set(action, ids);
				if (!was && ids.size > 0) onEdge(action, 'down');
				else if (was && ids.size === 0) onEdge(action, 'up');
			}
		},
		/** The link went: every held action lets go. */
		drop() {
			for (const [action, ids] of pressed)
				if (ids.size > 0) onEdge(action, 'drop');
			pressed.clear();
		},
	};
}
