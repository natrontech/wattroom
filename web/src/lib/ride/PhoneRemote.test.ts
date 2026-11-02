import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { ViewState } from '$lib/protocol';
import PhoneRemote from './PhoneRemote.svelte';

const remote = (
	view: ViewState | null,
	gear: { label: string; atEnd: boolean } | null = null,
) =>
	render(PhoneRemote, {
		props: {
			live: {
				view,
				gear,
				pause: null,
				remoteRefusal: null,
				sendRemote: () => {},
				sendTalk: () => {},
			} as never,
			onclose: () => {},
		},
	}).body;

/** Whether the button worded `label` renders disabled (its class aside). */
function disabled(html: string, label: string): boolean {
	const button = new RegExp(
		`<button([^>]*)>\\s*(?:<!---->)?\\s*${label}\\s*<`,
	).exec(html);
	if (!button) throw new Error(`no ${label} button`);
	return /\sdisabled\b/.test(button[1].replace(/class="[^"]*"/, ''));
}

describe('the phone remote (#4253)', () => {
	it('waits for 3D with Camera and Photo, and says so under them', () => {
		const html = remote({ page: 'ride', world: false });
		expect(disabled(html, 'Camera')).toBe(true);
		expect(disabled(html, 'Photo')).toBe(true);
		expect(disabled(html, 'Cheer')).toBe(false);
		expect(html).toContain('Camera and Photo need 3D.');
		// Under the pair it explains, above the line and the shifter.
		const hint = html.indexOf('Camera and Photo need 3D.');
		const photo = html.search(/>\s*(?:<!---->)?\s*Photo\s*</);
		expect(photo).toBeGreaterThan(-1);
		expect(photo).toBeLessThan(hint);
		expect(hint).toBeLessThan(html.indexOf('RIDE · Flat'));
	});

	it('runs Camera and Photo while the riding screen draws 3D, and names its camera', () => {
		const html = remote({ page: 'ride', world: true, camera: 'heli' });
		expect(disabled(html, 'Camera')).toBe(false);
		expect(disabled(html, 'Photo')).toBe(false);
		expect(html).not.toContain('need 3D');
		expect(html).toContain('RIDE · 3D · Overhead');
	});

	it('names the gear under the shifter, a blind one too (#4235)', () => {
		const line = (label: string, atEnd = false) =>
			/data-testid="remote-gear"[^>]*>([^<]*(?:<!---->[^<]*)*)</
				.exec(remote(null, { label, atEnd }))?.[1]
				.replaceAll('<!---->', '')
				.replace(/\s+/g, ' ')
				.trim();
		expect(line('0')).toBe('Gear 0');
		expect(line('+2')).toBe('Gear +2');
		expect(line('Gear 15', true)).toBe('Gear 15 · end');
	});
});
