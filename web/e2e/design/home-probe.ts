/**
 * Home's measurements (#3688): what docs/design/TARGETS.md's `home` items
 * name, taken at the window's own size before the shot grows it, so "above
 * the fold" is read at 1440 × 900. Passed whole to `page.evaluate`, so it
 * closes over nothing outside itself.
 */
export function homeProbe() {
	type Box = { x: number; y: number; w: number; h: number; bottom: number };
	const box = (el: Element | null | undefined): Box | null => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return {
			x: Math.round(r.left),
			y: Math.round(r.top),
			w: Math.round(r.width),
			h: Math.round(r.height),
			bottom: Math.round(r.bottom),
		};
	};
	const text = (el: Element | null | undefined, n = 40) =>
		(el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
	// A token as the page resolves it, to compare a computed colour against.
	const token = (name: string) => {
		const el = document.createElement('span');
		el.style.color = `var(${name})`;
		document.querySelector('main')?.append(el);
		const color = getComputedStyle(el).color;
		el.remove();
		return color;
	};
	const filled = (el: Element) => {
		const bg = getComputedStyle(el).backgroundColor;
		return bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg);
	};

	const main = document.querySelector('main.page');
	const title = main?.querySelector('h1');
	// Each block the page stacks, top to bottom, with its left edge.
	const blocks = [...(main?.children ?? [])]
		.filter((el) => el.getBoundingClientRect().height > 0)
		.map((el) => ({
			what:
				(el as HTMLElement).dataset.testid ||
				el.querySelector('.eyebrow')?.textContent?.trim().slice(0, 30) ||
				text(el, 30),
			...box(el)!,
		}));

	const actions = document.querySelector('[data-testid=home-actions]');
	const buttons = [
		...(actions?.querySelectorAll('a.btn, button.btn, summary.btn') ?? []),
	].map((el) => ({
		label: text(el),
		h: Math.round(el.getBoundingClientRect().height),
		filled: filled(el),
	}));

	const muted = token('--color-muted');
	const tiles = [
		...(document.querySelector('[data-testid=home-tiles]')?.children ?? []),
	].map((tile) => {
		const value = tile.querySelector('.font-display');
		const unit = value?.querySelector('span');
		const cs = value ? getComputedStyle(value) : null;
		return {
			...box(tile)!,
			eyebrow: text(tile.querySelector('.eyebrow')),
			value: text(value, 12),
			valuePx: cs ? parseFloat(cs.fontSize) : null,
			valueFont: cs?.fontFamily.split(',')[0].trim() ?? null,
			unit: unit ? text(unit, 12) : null,
			unitMuted: unit ? getComputedStyle(unit).color === muted : null,
			unitOnBaseline: unit
				? getComputedStyle(unit).verticalAlign === 'baseline'
				: null,
		};
	});

	const week = document.getElementById('sessions');
	const weekHeading = week?.querySelector('h2');
	const firstRow = week?.querySelector('li') ?? null;
	// This week's rows (#3689, TARGETS home 7-9): each row's link, its time
	// column, its count's place, and whether it is dimmed or live.
	const ok = token('--color-ok');
	const dayHeaders = [...(week?.querySelectorAll('h3') ?? [])].map((h) => ({
		text: text(h),
		eyebrow: h.classList.contains('eyebrow'),
	}));
	const weekRows = [
		...(week?.querySelectorAll('[data-testid=week-row]') ?? []),
	].map((li) => {
		const link = li.querySelector('a');
		const column = link?.firstElementChild ?? null;
		const time = column?.firstElementChild ?? null;
		const lines = link?.querySelectorAll('p') ?? [];
		const count = link?.querySelector('span.tabular-nums:not(.font-display)');
		const dot = link?.querySelector('span.rounded-full');
		const timeCs = time ? getComputedStyle(time) : null;
		return {
			...box(link)!,
			wholeRowLink: !!link && link.parentElement === li,
			time: text(time, 12),
			period: text(column?.children[1], 4) || null,
			timeColumn: box(column)?.w ?? null,
			timeOneLine: time ? box(time)!.h <= 22 : null,
			timePx: timeCs ? parseFloat(timeCs.fontSize) : null,
			timeFont: timeCs?.fontFamily.split(',')[0].trim() ?? null,
			kind: text(lines[0]),
			title: text(lines[1]),
			meta: text(lines[2], 80),
			count: count ? text(count, 20) : null,
			countBox: box(count),
			titleBox: box(lines[1]),
			opacity: link ? parseFloat(getComputedStyle(link).opacity) : null,
			background: link ? getComputedStyle(link).backgroundColor : null,
			liveDotOk: dot ? getComputedStyle(dot).backgroundColor === ok : null,
		};
	});
	const around = [...document.querySelectorAll('main h2')].find((h) =>
		/around right now/i.test(h.textContent ?? ''),
	);
	const recent = [...document.querySelectorAll('main h2')].find((h) =>
		/recent rides/i.test(h.textContent ?? ''),
	);
	const viewport = innerHeight;

	return {
		viewport: { w: innerWidth, h: viewport },
		titleX: box(title)?.x ?? null,
		blocks,
		actions: {
			buttons,
			filledCount: buttons.filter((b) => b.filled).length,
			minHeight: Math.min(...buttons.map((b) => b.h)),
		},
		startACrew: [...(main?.querySelectorAll('a, button') ?? [])].filter(
			(el) => text(el) === 'Start a crew',
		).length,
		tiles,
		week: {
			heading: box(weekHeading),
			headingText: text(weekHeading),
			firstRow: box(firstRow),
			dayHeaders,
			rows: weekRows,
			nextHeading: [...(week?.querySelectorAll('h3') ?? [])].some(
				(h) => text(h) === 'Next',
			),
			teaching: text(week?.querySelector('p.text-sm'), 120),
			scrollsSideways: !!week && week.scrollWidth > Math.ceil(week.clientWidth),
			aboveTheFold:
				!!weekHeading &&
				(box(firstRow ?? weekHeading)?.bottom ?? Infinity) <= viewport,
		},
		columns: {
			week: box(week?.parentElement),
			around: box(around?.closest('section')),
			recent: box(recent?.closest('section')),
		},
	};
}
