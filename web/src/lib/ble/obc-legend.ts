/**
 * The OpenBikeControl IDs WattRoom answers, by name (#4547): the
 * Controllers table (#4563) reads the Click V2's buttons from here. An ID
 * added to OBC_BUTTONS without a name here fails its test.
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
