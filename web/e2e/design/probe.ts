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
		// A text shadow inherits: the spans a figure is drawn in (TabularFigures,
		// #3869) carry its glow, and are that glow rather than another one.
		const inherited =
			cs.textShadow !== 'none' &&
			!cs.filter.includes('drop-shadow') &&
			(cs.boxShadow === 'none' || cs.boxShadow.includes('inset')) &&
			!!el.parentElement &&
			getComputedStyle(el.parentElement).textShadow === cs.textShadow;
		if (glowing(cs) && !inherited && glows.length < 20)
			glows.push(
				(
					own ||
					el.getAttribute('aria-label') ||
					el.textContent?.trim() ||
					el.tagName
				).slice(0, 40),
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
	// reached through its label: neither is counted. A checkbox or radio inside
	// its <label> is targeted through that label, which activates it (#3755), so
	// the label's box is the one measured.
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
			const hit =
				el instanceof HTMLInputElement &&
				(el.type === 'checkbox' || el.type === 'radio')
					? (el.closest('label') ?? el)
					: el;
			const r = hit.getBoundingClientRect();
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
		// The world's own measurements, where /dev/world's dev hook reports them
		// (#3672): camera.fov, renderer.draws and .triangles, figure.bboxH.
		...((
			window as unknown as {
				__worldProbe?: () => Record<string, unknown>;
			}
		).__worldProbe?.() ?? {}),
	};
}

/**
 * The near asphalt's colour (#3674): a 9 px patch of the screenshot `png`
 * (base64) where the world's probe projects the road ahead of your wheel,
 * `at` in the canvas's clip space. Decoded in the page, which has a PNG
 * decoder where node has none.
 */
export async function sampleAt({
	png,
	at: [nx, ny],
}: {
	png: string;
	at: [number, number];
}): Promise<number[]> {
	const world = [...document.querySelectorAll('canvas')].sort(
		(a, b) => b.width * b.height - a.width * a.height,
	)[0];
	const r = world.getBoundingClientRect();
	const img = new Image();
	img.src = `data:image/png;base64,${png}`;
	await img.decode();
	const k = img.width / innerWidth;
	const x = Math.round((r.left + ((nx + 1) / 2) * r.width) * k);
	const y = Math.round((r.top + ((1 - ny) / 2) * r.height) * k);
	const c = document.createElement('canvas');
	[c.width, c.height] = [img.width, img.height];
	const g = c.getContext('2d')!;
	g.drawImage(img, 0, 0);
	const d = g.getImageData(x - 4, y - 4, 9, 9).data;
	const sum = [0, 0, 0];
	for (let i = 0; i < d.length; i += 4)
		for (let j = 0; j < 3; j++) sum[j] += d[i + j];
	return sum.map((v) => Math.round(v / (d.length / 4)));
}

/**
 * The HUD's scale (#3857, TARGETS hud item 2), taken in the page: how tall the
 * watts' numerals stand against the window, where the block sits in it (each
 * edge as a percentage of the window's width or height), and every text's
 * font size in vh, which SPEC's HUD column bounds.
 */
export function hudScale() {
	const pct = (n: number, of: number) => Math.round((n / of) * 1000) / 10;
	const block = document.querySelector('.hud');
	const watts = document.querySelector('[data-testid=hud-watts]');
	let numeralVh: number | null = null;
	if (watts) {
		const cs = getComputedStyle(watts);
		const ctx = document.createElement('canvas').getContext('2d')!;
		ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
		const m = ctx.measureText(watts.textContent ?? '');
		numeralVh = pct(
			m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
			innerHeight,
		);
	}
	const r = block?.getBoundingClientRect();
	const texts = [...(block?.querySelectorAll('*') ?? [])]
		.map((el) => ({
			text: [...el.childNodes]
				.filter((n) => n.nodeType === Node.TEXT_NODE)
				.map((n) => n.textContent)
				.join('')
				.trim()
				.slice(0, 24),
			vh: pct(parseFloat(getComputedStyle(el).fontSize), innerHeight),
		}))
		.filter((t) => t.text);
	return {
		numeralVh,
		block: r && {
			x0: pct(r.left, innerWidth),
			y0: pct(r.top, innerHeight),
			x1: pct(r.right, innerWidth),
			y1: pct(r.bottom, innerHeight),
		},
		texts,
	};
}
