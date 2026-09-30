/**
 * The design shots' measurements (#3666), taken in the page: the only evidence
 * a design reviewer may cite (docs/design/DESIGN-CHECK.md). Passed whole to
 * `page.evaluate`, so it closes over nothing outside itself.
 */
export interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export function probe(corridor: Box) {
	type Rgba = { r: number; g: number; b: number; a: number };
	const ctx = document
		.createElement('canvas')
		.getContext('2d', { willReadFrequently: true })!;
	// Any CSS colour, oklch and color-mix included, as the canvas resolves it.
	const rgba = (color: string): Rgba => {
		ctx.clearRect(0, 0, 1, 1);
		ctx.fillStyle = '#0000';
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
		return { r, g, b, a: a / 255 };
	};
	// OKLab's L, the lightness TARGETS G1 bounds.
	const lightness = ({ r, g, b }: Rgba) => {
		const lin = (c: number) =>
			(c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		const [R, G, B] = [lin(r), lin(g), lin(b)];
		const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
		const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
		const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
		return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	};
	const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
	const shown = (el: Element) => {
		const r = el.getBoundingClientRect();
		const cs = getComputedStyle(el);
		return (
			r.width > 0 &&
			r.height > 0 &&
			cs.visibility !== 'hidden' &&
			r.bottom > 0 &&
			r.top < innerHeight
		);
	};
	const ownText = (el: Element) =>
		[...el.childNodes]
			.filter((n) => n.nodeType === Node.TEXT_NODE)
			.map((n) => n.textContent)
			.join('')
			.trim();
	const cave = document.querySelector('.cave');

	// G1: the lightest surface under a 6 × 5 grid of points, the world excepted.
	// A surface is a large box: a zone bar or a chip on it is not.
	let maxL = 0;
	for (const fx of [0.02, 0.2, 0.4, 0.6, 0.8, 0.98])
		for (const fy of [0.02, 0.25, 0.5, 0.75, 0.98]) {
			let el = document.elementFromPoint(fx * innerWidth, fy * innerHeight);
			if (!el || el.closest('canvas')) continue;
			let bg: Rgba | null = null;
			for (; el; el = el.parentElement) {
				const r = el.getBoundingClientRect();
				if (r.width * r.height < 0.05 * innerWidth * innerHeight) continue;
				const c = rgba(getComputedStyle(el).backgroundColor);
				if (c.a > 0.5) {
					bg = c;
					break;
				}
			}
			maxL = Math.max(
				maxL,
				lightness(
					bg ??
						rgba(getComputedStyle(document.documentElement).backgroundColor),
				),
			);
		}

	// G2: what is in watt, and what glows. The token is read inside the cave,
	// where it may differ from the desk's.
	const swatch = document.createElement('span');
	swatch.style.color = 'var(--color-watt)';
	(cave ?? document.body).append(swatch);
	const watt = rgba(getComputedStyle(swatch).color);
	swatch.remove();
	const isWatt = (color: string) => {
		const c = rgba(color);
		return (
			c.a > 0.3 &&
			Math.abs(c.r - watt.r) + Math.abs(c.g - watt.g) + Math.abs(c.b - watt.b) <
				24
		);
	};
	const glowing = (cs: CSSStyleDeclaration) =>
		cs.textShadow !== 'none' ||
		cs.filter.includes('drop-shadow') ||
		(cs.boxShadow !== 'none' && !cs.boxShadow.includes('inset'));
	const wattFigures: { text: string; glow: boolean }[] = [];
	const glows: string[] = [];
	let wattMarks = 0;
	for (const el of document.body.querySelectorAll('*')) {
		if (!shown(el)) continue;
		const cs = getComputedStyle(el);
		const own = ownText(el);
		const svg = el instanceof SVGElement;
		if (/\d/.test(own) && isWatt(svg ? cs.fill : cs.color))
			wattFigures.push({ text: own.slice(0, 40), glow: glowing(cs) });
		else if (
			el instanceof SVGGeometryElement &&
			(isWatt(cs.fill) || isWatt(cs.stroke))
		)
			wattMarks++;
		if (glowing(cs) && glows.length < 20)
			glows.push(
				(own || el.getAttribute('aria-label') || el.tagName).slice(0, 40),
			);
	}

	// G3: the docks over the world, against the keep-clear corridor.
	const surface = document
		.querySelector('[data-surface=docked]')
		?.getBoundingClientRect();
	const panels = surface
		? [...document.querySelectorAll<HTMLElement>('[data-dock]')]
				.filter(shown)
				.map((el) => {
					const r = el.getBoundingClientRect();
					const box = {
						x0: round((r.left - surface.left) / surface.width),
						y0: round((r.top - surface.top) / surface.height),
						x1: round((r.right - surface.left) / surface.width),
						y1: round((r.bottom - surface.top) / surface.height),
					};
					return {
						dock: el.dataset.dock,
						box,
						alpha: round(rgba(getComputedStyle(el).backgroundColor).a, 2),
						overflow:
							el.scrollHeight > el.clientHeight + 1 ||
							el.scrollWidth > el.clientWidth + 1,
						corridor:
							box.x0 < corridor.x1 &&
							box.x1 > corridor.x0 &&
							box.y0 < corridor.y1 &&
							box.y1 > corridor.y0,
					};
				})
		: [];

	// G5: sideways overflow and the smallest control. The app's shell hides a
	// page's overflow, so there it is the page body's; the public site has no
	// page body and scrolls its document. A control inside a sentence is
	// SC 2.5.8's inline exception, and a visually hidden one (sr-only, 1 px) is
	// reached through its label: neither is counted.
	const body = document.querySelector('[data-testid=page-body]');
	const root = document.documentElement;
	const inSentence = (el: Element) =>
		getComputedStyle(el).display === 'inline' ||
		[...(el.parentElement?.childNodes ?? [])].some(
			(n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
		);
	const sizes = [
		...document.querySelectorAll<HTMLElement>(
			'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button]',
		),
	]
		.filter((el) => {
			const r = el.getBoundingClientRect();
			return shown(el) && r.width > 1 && r.height > 1 && !inSentence(el);
		})
		.map((el) => {
			const r = el.getBoundingClientRect();
			const label =
				el.getAttribute('aria-label') ||
				el.innerText ||
				el.getAttribute('title') ||
				el.tagName;
			return {
				px: Math.round(Math.min(r.width, r.height)),
				label: label.trim().slice(0, 40),
			};
		});
	const smallest = sizes.reduce<{ px: number; label: string | null }>(
		(a, b) => (b.px < a.px ? b : a),
		{ px: Infinity, label: null },
	);

	return {
		cave: { present: !!cave, maxSurfaceL: round(maxL) },
		overflowX: body
			? body.scrollWidth - body.clientWidth
			: root.scrollWidth - root.clientWidth,
		wattCount: wattFigures.length,
		wattFigures,
		wattMarks,
		glows,
		panels,
		minTarget: {
			px: Number.isFinite(smallest.px) ? smallest.px : null,
			label: smallest.label,
			under24: sizes.filter((s) => s.px < 24).length,
			under44: sizes.filter((s) => s.px < 44).length,
		},
		world: {
			mounted: !!document.querySelector('canvas'),
			fallback: document.body.innerText.match(/Flat road —[^\n]*/)?.[0] ?? null,
		},
	};
}

export type Probes = ReturnType<typeof probe>;
