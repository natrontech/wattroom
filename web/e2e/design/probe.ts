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
	// G1: the lightest and the darkest surface under a 6 × 5 grid of points.
	// A surface is a large box: a zone bar or a chip on it is not. A ride keeps
	// the capture's scheme (#4160); TV mode and the HUD are the cave, dark in
	// either. The world, a camera frame and a video are not surfaces: a
	// canvas, a cave smaller than half the window, a video's black ground.
	const area = innerWidth * innerHeight;
	const notSurface = (el: Element) => {
		if (el.closest('canvas, video, iframe')) return true;
		const frame = el.closest('.cave')?.getBoundingClientRect();
		return !!frame && frame.width * frame.height < 0.5 * area;
	};
	let maxL = 0;
	let minL = 1;
	for (const fx of [0.02, 0.2, 0.4, 0.6, 0.8, 0.98])
		for (const fy of [0.02, 0.25, 0.5, 0.75, 0.98]) {
			let el = document.elementFromPoint(fx * innerWidth, fy * innerHeight);
			if (!el || notSurface(el)) continue;
			let bg: Rgba | null = null;
			for (; el; el = el.parentElement) {
				const r = el.getBoundingClientRect();
				if (r.width * r.height < 0.05 * area) continue;
				const c = rgba(getComputedStyle(el).backgroundColor);
				if (c.a > 0.5) {
					bg = c;
					break;
				}
			}
			if (bg && bg.r + bg.g + bg.b === 0) continue;
			const l = lightness(
				bg ?? rgba(getComputedStyle(document.body).backgroundColor),
			);
			maxL = Math.max(maxL, l);
			minL = Math.min(minL, l);
		}

	// G2: what is in watt, and what glows. The token is read twice, as the
	// page paints it and as the cave does (TV mode, a camera frame), where it
	// is the dark half even on a light page.
	const watts = ['', 'cave'].map((className) => {
		const swatch = document.createElement('span');
		swatch.className = className;
		swatch.style.color = 'var(--color-watt)';
		document.body.append(swatch);
		const watt = rgba(getComputedStyle(swatch).color);
		swatch.remove();
		return watt;
	});
	const isWatt = (color: string) => {
		const c = rgba(color);
		return (
			c.a > 0.3 &&
			watts.some(
				(watt) =>
					Math.abs(c.r - watt.r) +
						Math.abs(c.g - watt.g) +
						Math.abs(c.b - watt.b) <
					24,
			)
		);
	};
	const glowing = (cs: CSSStyleDeclaration) =>
		cs.textShadow !== 'none' ||
		cs.filter.includes('drop-shadow') ||
		(cs.boxShadow !== 'none' && !cs.boxShadow.includes('inset'));
	// An open modal's opaque box hides what lies wholly under it (#3989): the
	// stage's own tile still glows behind a session's closing card, unseen.
	const modals = [
		...document.querySelectorAll(
			'[aria-modal=true], [data-testid=session-card]',
		),
	]
		.filter(
			(el) => shown(el) && rgba(getComputedStyle(el).backgroundColor).a > 0.9,
		)
		.map((el) => el.getBoundingClientRect());
	const covered = (el: Element) => {
		if (el.closest('[aria-modal=true], [data-testid=session-card]'))
			return false;
		const r = el.getBoundingClientRect();
		return modals.some(
			(m) =>
				r.left >= m.left &&
				r.right <= m.right &&
				r.top >= m.top &&
				r.bottom <= m.bottom,
		);
	};
	// A closing card is held to its own content: the crew rail beside it keeps
	// its live watts tile, which G2 lets glow on any page.
	const rail = document.querySelector(
		'[data-testid=closing-card], [data-testid=session-card]',
	)
		? document.querySelector('aside')
		: null;
	const wattFigures: { text: string; glow: boolean }[] = [];
	const glows: string[] = [];
	let wattMarks = 0;
	for (const el of document.body.querySelectorAll('*')) {
		if (!shown(el) || covered(el) || rail?.contains(el)) continue;
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
	// The flat layout's panels in px (#3670): the gap between neighbours, and
	// the slack under each one's last child, which is the empty band G3 caps.
	// A row of panels (#4159) counts each one; a dock inside a dock does not.
	const flatEl = document.querySelector<HTMLElement>('[data-surface=flat]');
	const flatPanels = flatEl
		? [...flatEl.querySelectorAll<HTMLElement>('[data-dock]')].filter(
				(el) => shown(el) && !el.parentElement?.closest('[data-dock]'),
			)
		: [];
	const boxes = flatPanels.map((el) => el.getBoundingClientRect());
	// The gap to the nearest panel above that it overlaps (a column's
	// neighbour), and to the nearest one on its left (a row's).
	const nearest = (
		i: number,
		before: (q: DOMRect, p: DOMRect) => boolean,
		gap: (q: DOMRect, p: DOMRect) => number,
	) => {
		const ds = boxes
			.filter((q, j) => j !== i && before(q, boxes[i]))
			.map((q) => gap(q, boxes[i]));
		return ds.length ? round(Math.min(...ds)) : null;
	};
	const overlapX = (q: DOMRect, p: DOMRect) =>
		q.left < p.right && q.right > p.left;
	const overlapY = (q: DOMRect, p: DOMRect) =>
		q.top < p.bottom && q.bottom > p.top;
	// The widest stripe down a panel that nothing drawn reaches into (#4159):
	// G3's band, sideways. What is drawn is a box with its own text, an empty
	// box, or a picture; a container spanning the row would hide the stripe,
	// and so would a tap target laid over the whole panel (ADR-0071's page turn).
	const drawn = (c: Element) =>
		!c.parentElement?.closest('svg') &&
		(c.matches('svg, img, video, canvas, input') ||
			!!ownText(c) ||
			![...c.children].some(shown));
	const bandX = (el: Element, r: DOMRect) => {
		const covers = (b: DOMRect) =>
			b.width >= 0.9 * r.width && b.height >= 0.9 * r.height;
		const runs = [...el.querySelectorAll('*')]
			.filter((c) => shown(c) && drawn(c))
			.filter(
				(c) => !(c.matches('button') && covers(c.getBoundingClientRect())),
			)
			.map((c) => c.getBoundingClientRect())
			.sort((a, b) => a.left - b.left);
		let reach = r.left;
		let band = 0;
		for (const c of runs) {
			band = Math.max(band, c.left - reach);
			reach = Math.max(reach, c.right);
		}
		return round(Math.max(band, r.right - reach));
	};
	const flat = flatEl
		? {
				panels: flatPanels.map((el) => {
					const r = el.getBoundingClientRect();
					const last = Math.max(
						r.top,
						...[...el.querySelectorAll<HTMLElement>('*')]
							.filter(shown)
							.map((c) => c.getBoundingClientRect().bottom),
					);
					return {
						dock: el.dataset.dock,
						top: round(r.top),
						left: round(r.left),
						width: round(r.width),
						height: round(r.height),
						slack: round(Math.max(0, r.bottom - last)),
						bandX: bandX(el, r),
					};
				}),
				gaps: boxes
					.map((_, i) =>
						nearest(
							i,
							(q, p) => overlapX(q, p) && q.bottom <= p.top + 1,
							(q, p) => p.top - q.bottom,
						),
					)
					.filter((g) => g !== null),
				gapsX: boxes
					.map((_, i) =>
						nearest(
							i,
							(q, p) => overlapY(q, p) && q.right <= p.left + 1,
							(q, p) => p.left - q.right,
						),
					)
					.filter((g) => g !== null),
			}
		: null;
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
	// A worded control's word (G4): the smallest shown text in it with letters,
	// where it has any. Its own font size alone misses words set on a span.
	const wordPx = (el: Element) => {
		const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let min: number | null = null;
		for (let n = walk.nextNode(); n; n = walk.nextNode()) {
			const host = n.parentElement;
			if (!host || !/\p{L}/u.test(n.textContent ?? '')) continue;
			// An avatar's initial stands in for a picture; its name is read by sr-only text (#4046).
			if (host.closest('[data-avatar]')) continue;
			const box = host.getBoundingClientRect();
			// sr-only text is 1 px and read aloud, not seen.
			if (!host.checkVisibility() || !shown(host) || box.width <= 1) continue;
			const px = parseFloat(getComputedStyle(host).fontSize);
			min = min === null ? px : Math.min(min, px);
		}
		// A field's placeholder is a word while it shows (#4046).
		if (el instanceof HTMLInputElement && el.placeholder && !el.value) {
			const px = parseFloat(getComputedStyle(el).fontSize);
			min = min === null ? px : Math.min(min, px);
		}
		return min;
	};
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
				// The sidebar, the people column and a menu are app chrome, not a
				// riding surface (G4, ADR-0087): they keep the desk's words.
				wordPx: el.closest(
					'nav[aria-label="crews and channels"], aside, [role=menu]',
				)
					? null
					: wordPx(el),
			};
		});
	const smallest = sizes.reduce<{ px: number; label: string | null }>(
		(a, b) => (b.px < a.px ? b : a),
		{ px: Infinity, label: null },
	);

	const words = sizes.filter((s) => s.wordPx !== null);

	return {
		scheme: {
			ride: !!document.querySelector('[data-ride]'),
			minSurfaceL: round(minL),
			maxSurfaceL: round(maxL),
		},
		overflowX: body
			? body.scrollWidth - body.clientWidth
			: root.scrollWidth - root.clientWidth,
		wattCount: wattFigures.length,
		wattFigures,
		wattMarks,
		glows,
		panels,
		flat,
		// How far your ghost's name runs past the Skyline's edges (#3245): 0 inside.
		ghostLabelOverflow: (() => {
			const label = document.querySelector(
				'[data-testid=skyline-ghost] [data-testid=skyline-ghost-label]',
			);
			const strip = document.querySelector('[data-testid=skyline]');
			if (!label || !strip) return null;
			const l = label.getBoundingClientRect();
			const s = strip.getBoundingClientRect();
			return round(Math.max(0, s.left - l.left, l.right - s.right));
		})(),
		// How far the computer's page row runs past its panel's padding (#4042).
		pageRowOverflow: (() => {
			const row = document.querySelector('[data-testid=computer-page-row]');
			const last = row?.lastElementChild;
			if (!row || !last) return null;
			const pad = parseFloat(getComputedStyle(row.parentElement!).paddingRight);
			const panel = row.parentElement!.getBoundingClientRect();
			return round(
				Math.max(0, last.getBoundingClientRect().right - (panel.right - pad)),
			);
		})(),
		minTarget: {
			px: Number.isFinite(smallest.px) ? smallest.px : null,
			label: smallest.label,
			under24: sizes.filter((s) => s.px < 24).length,
			under44: sizes.filter((s) => s.px < 44).length,
		},
		// Headings drawn on more than one line (#4046): a label is one line (G4).
		wrappedLabels: [
			...document.querySelectorAll<HTMLElement>('.eyebrow, .ride-label'),
		]
			.filter((el) => {
				if (!shown(el)) return false;
				// Lines drawn: the distinct tops of its text's boxes, not its icons'.
				const tops = new Set<number>();
				const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
				for (let n = walk.nextNode(); n; n = walk.nextNode()) {
					if (!n.textContent?.trim()) continue;
					const range = document.createRange();
					range.selectNodeContents(n);
					for (const r of range.getClientRects())
						if (r.width > 1 && r.height > 1) tops.add(Math.round(r.top / 4));
				}
				return tops.size > 1;
			})
			.map((el) => el.innerText.trim().replace(/\s+/g, ' ').slice(0, 40)),
		// G4's floor for a riding surface's words; a desk page reads it as data.
		buttonWords: {
			minPx: words.length ? Math.min(...words.map((w) => w.wordPx!)) : null,
			under24: words.filter((w) => w.wordPx! < 24).map((w) => w.label),
		},
		// A phone's column (#3676): the head's font sizes against SPEC's phone row,
		// and the room under the last panel for the floating navigation button.
		phone: document.querySelector('[data-surface=phone]')
			? (() => {
					const px = (sel: string) => {
						const el = document.querySelector(sel);
						return el ? parseFloat(getComputedStyle(el).fontSize) : null;
					};
					const docks = [...document.querySelectorAll('[data-dock]')].filter(
						(el) => el.getBoundingClientRect().height > 0,
					);
					const last = docks[docks.length - 1]?.getBoundingClientRect();
					const page = body ?? root;
					return {
						watts: px('[data-testid=head-power]'),
						timeLeft: px('[data-testid=block-left]'),
						wkg: px('[data-field=wkg]'),
						zone: px('[data-testid=head-zone]'),
						bottomClear: last
							? Math.round(
									page.scrollHeight -
										(last.bottom +
											window.scrollY -
											page.getBoundingClientRect().top),
								)
							: null,
					};
				})()
			: null,
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
