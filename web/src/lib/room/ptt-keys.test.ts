// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { spaceBelongsTo } from './ptt-keys';

describe('spaceBelongsTo (push-to-talk)', () => {
	const el = (html: string) => {
		document.body.innerHTML = html;
		return document.body.firstElementChild!;
	};
	it('leaves Space to a text field, however it was focused', () => {
		expect(spaceBelongsTo(el('<input />'), () => false)).toBe(true);
		expect(spaceBelongsTo(el('<textarea></textarea>'), () => false)).toBe(true);
	});
	it('leaves Space to a control the keyboard reached, so it still clicks', () => {
		expect(spaceBelongsTo(el('<button>Mute</button>'), () => true)).toBe(true);
		const inner = el(
			'<a href="/home"><span>Home</span></a>',
		).firstElementChild!;
		expect(spaceBelongsTo(inner, () => true)).toBe(true);
	});
	it('keeps Space for the mic on a mouse-focused control and on the page', () => {
		expect(spaceBelongsTo(el('<button>Join voice</button>'), () => false)).toBe(
			false,
		);
		expect(spaceBelongsTo(document.body, () => true)).toBe(false);
		expect(spaceBelongsTo(null)).toBe(false);
	});
});
