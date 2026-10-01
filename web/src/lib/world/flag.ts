/**
 * The world in slot 2, per device (#3031, ADR-0066): off until the
 * riding-surface check (#3082) has measured it, and a separate issue flips
 * the default. /dev/world switches it on for this browser.
 */
const KEY = 'wattroom.world-slot.v1';

export function worldSlotOn(): boolean {
	try {
		return localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}

export function setWorldSlot(on: boolean): void {
	try {
		if (on) localStorage.setItem(KEY, '1');
		else localStorage.removeItem(KEY);
	} catch {
		/* a browser that keeps nothing keeps the default: off */
	}
}
