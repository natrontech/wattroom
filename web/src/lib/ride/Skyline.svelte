<script module lang="ts">
	// ponytail: one trail of your watts per road for the page's life, so a
	// remount (3D and flat, a resize) keeps it; a new ride's road starts a new one.
	const trails = new WeakMap<object, { m: number; w: number }[]>();
</script>

<script lang="ts">
	/**
	 * The Skyline (#3059, ADR-0066): the road ahead in slot 5 — the profile
	 * in five grade steps, the climbs by class where they top out, a road
	 * workout's blocks under it, and your dot. The world's fallback, and the
	 * horizon of every ride on a road.
	 *
	 * Cheap by construction (#2998, PERFORMANCE.md): the road is SVG tiles no
	 * wider than 4096 px, redrawn only when a second arrives; between seconds
	 * a timer at most 10 times a second only moves them, and never a CSS
	 * transition. Below 8 km/h they move once a second; for a rider who asked
	 * for stillness nothing scrolls at all — a fixed 2 km page the dot walks
	 * across, turned at once at its end (#3080). Your dot is the only glow, a
	 * halo painted once.
	 *
	 * Flat, as the ground under the rail (a `.flat-ground` ancestor, #4536), it
	 * is a place: the world's dusk over its ridges, the road on a meadow with
	 * the grade on the road itself, a post at each kilometre and the riders
	 * around you by name. The sky and ridges are static and painted once; only
	 * the road layer moves, as before. Over the 3D world it stays the band.
	 */
	import { untrack } from 'svelte';
	import { innerHeight } from 'svelte/reactivity/window';
	import { ZONE_BG, ZONE_VAR, zoneOf } from '#lib/components/zones.ts';
	import { prefersReducedMotion } from '#lib/motion/index.ts';
	import { heightAt } from '#lib/road/at-metre.ts';
	import { climbsOf } from '#lib/road/climbs.ts';
	import { turnedRound, type Road } from '#lib/road/road.ts';
	import {
		aheadFor,
		bandIn,
		chipShift,
		chipsIn,
		createAheadEase,
		frameFor,
		GRADE_FILL,
		GRADE_STROKE,
		leadM,
		pagedFrame,
		postsIn,
		SKYLINE,
		stepsPerTick,
		tileOf,
		tilesIn,
		yOf,
		type BandBlock,
	} from '#lib/road/skyline.ts';

	let {
		road: stored,
		m: storedM,
		mps,
		reverse = false,
		band = [],
		strip = false,
		tv = false,
		ghosts = [],
		mates = [],
		watts,
		ftp = 0,
		finishM,
	}: {
		road: Road;
		/** The dot: metres along the stored road, as of the last second. */
		m: number;
		/**
		 * The lap rides back down the road (#3205): `m` counts down, and the
		 * road ahead is the one behind it on the stored road.
		 */
		reverse?: boolean;
		/** The dot's speed, m/s. */
		mps: number;
		/** A road workout's blocks, by metre. */
		band?: BandBlock[];
		/** Under a shared screen: a 40 px strip, the profile and the dot alone. */
		strip?: boolean;
		tv?: boolean;
		/** Your ghost (#3245) and the pacer (#3281): each one's metre on the stored road, its speed and its name. */
		ghosts?: { m: number; mps: number; label: string }[];
		/**
		 * The riders around you on this road (#4536), as the world draws them:
		 * each one's metre on the stored road, its speed along the road as you
		 * ride it, and its name.
		 */
		mates?: { m: number; mps: number; label: string }[];
		/**
		 * Your watts (the ride HUD, 2026-11): drawn as a line along the road
		 * ridden, a sample a second at its metre, and the window reaches
		 * `trailM` behind the dot for it.
		 */
		watts?: number;
		/** For the watts' zones: each stretch of the line takes its zone's colour. */
		ftp?: number;
		/** Where the road's finish stands, for a road drawn on past it (a loop's next lap): a flag at that metre. */
		finishM?: number;
	} = $props();

	/** The dot's halo, painted once: the watt colour fading out, no filter. */
	const HALO =
		'radial-gradient(circle, var(--color-watt) 0 28%, color-mix(in oklab, var(--color-watt) 35%, transparent) 42%, transparent 70%)';

	// The road as this lap rides it: the Skyline always looks ahead.
	const road = $derived(reverse ? turnedRound(stored) : stored);
	const m = $derived(reverse ? stored.length - storedM : storedM);

	// The profile keeps half a dot clear above and below, so the dot sits
	// wholly inside its panel at a summit and in a valley (#3668).
	const pad = $derived(tv ? '2vh' : '12px');
	const uid = $props.id();
	let width = $state(0);
	let height = $state(0);
	// At least half the widest class chip, "III" (3vh on a TV), so it sits flush.
	const chipEdge = $derived(tv ? 0.05 * (innerHeight.current ?? 1080) : 24);
	const climbs = $derived(climbsOf(road));
	const behind = $derived(
		watts === undefined ? SKYLINE.behindM : SKYLINE.trailM,
	);
	// Your watts along the road ridden: one sample per new second, at its metre.
	let trail = $state(untrack(() => trails.get(stored) ?? []));
	$effect(() => {
		const here = m;
		const w = untrack(() => watts);
		if (w === undefined) return;
		const reach = untrack(() => behind);
		const next = [
			...untrack(() => trail).filter((p) => p.m <= here && here - p.m <= reach),
			{ m: here, w },
		];
		trail = next;
		trails.set(
			untrack(() => stored),
			next,
		);
	});
	const paged = $derived(prefersReducedMotion.current);
	const perTick = $derived(stepsPerTick(mps, paged));

	// The reach ahead eases with the speed, a second at a time.
	const ease = createAheadEase(untrack(() => aheadFor(mps)));
	let ahead = $state(untrack(() => aheadFor(mps)));
	let secondAt = performance.now();
	let now = $state(performance.now());
	$effect(() => {
		// A new second: where the dot is, and how far ahead to look.
		void m;
		const at = performance.now();
		ahead = ease.step(
			aheadFor(untrack(() => mps)),
			Math.min(2, (at - secondAt) / 1000),
		);
		secondAt = at;
		now = at;
	});
	$effect(() => {
		if (perTick) return;
		const id = setInterval(
			() => (now = performance.now()),
			1000 / SKYLINE.stepHz,
		);
		return () => clearInterval(id);
	});

	// Redrawn once a second; moved between.
	const frame = $derived(
		!width || !height
			? null
			: paged
				? pagedFrame(road, m, width, height)
				: frameFor(road, m, ahead, width, height, behind),
	);
	const tiles = $derived(
		frame
			? tilesIn(frame, road, Math.max(0, mps)).map((i) =>
					tileOf(frame, road, i),
				)
			: [],
	);
	const chips = $derived(frame && !strip ? chipsIn(frame, road, climbs) : []);
	const blocks = $derived(frame && !strip ? bandIn(frame, band) : []);
	/** Where the dot is now: the last second, carried on at its speed. */
	const shown = $derived(
		perTick
			? m
			: Math.min(road.length, m + mps * Math.min(1, (now - secondAt) / 1000)),
	);
	// Scrolling, the road moves under a dot that stays, once it is 0.5 km in;
	// paged, and before that, the dot walks.
	const lead = $derived(
		paged ? shown - (frame?.fromM ?? 0) : leadM(shown, behind),
	);
	// The watts' own scale: the trail's peak with room over it, never under
	// 300 W. Cut into runs by zone, as Zwift colours its power: each run starts
	// on the last point of the one before, so the line has no gaps.
	const trailRuns = $derived.by(() => {
		if (!frame || trail.length < 2) return [];
		const on = frame;
		const top = Math.max(300, ...trail.map((p) => p.w)) * 1.15;
		// A lane along the bottom, so a tall flat ground keeps the line low.
		const lane = Math.min(on.height, Math.max(160, on.height * 0.35));
		const xy = (p: { m: number; w: number }) =>
			`${(p.m * on.scale).toFixed(1)},${(on.height - (p.w / top) * lane).toFixed(1)}`;
		const runs: { zone: number; points: string[] }[] = [];
		for (const p of trail) {
			const zone = ftp > 0 ? zoneOf(p.w, ftp) : 0;
			const last = runs.at(-1);
			if (last?.zone === zone) last.points.push(xy(p));
			else
				runs.push({
					zone,
					points: last ? [last.points.at(-1)!, xy(p)] : [xy(p)],
				});
		}
		return runs.map((r) => ({
			stroke: ZONE_VAR[r.zone] || 'var(--color-watt)',
			points: r.points.join(' '),
		}));
	});
	const shift = $derived(!frame ? 0 : (shown - lead) * frame.scale);
	const dot = $derived(
		frame
			? {
					x: lead * frame.scale,
					y: yOf(frame, heightAt(road, shown)),
				}
			: null,
	);
	// Your ghosts on the road layer, carried on between seconds as the dot is.
	const haunts = $derived.by(() => {
		if (!frame || strip) return [];
		const on = frame;
		return ghosts.map((ghost) => placed(on, ghost));
	});
	// The riders around you, the same way: only those in the window.
	const around = $derived.by(() => {
		if (!frame || strip) return [];
		const on = frame;
		return mates
			.map((mate) => placed(on, mate))
			.filter((p) => p.x - shift >= 0 && p.x - shift <= width);
	});
	// The distance posts, flat only (the ground hides them in a band).
	const posts = $derived(frame && !strip ? postsIn(frame, road) : []);
	// The road on the land, flat: wide enough to carry its grade at arm's length.
	const roadW = $derived(tv ? 10 : 8);
	// How deep the meadow under the road runs before the deeper field.
	const verge = $derived(Math.max(28, height * 0.07));
	// The ridges keep their shape at any width: a narrow window sees less of
	// the range rather than the range squeezed into spikes. Their 1200 units
	// span a desk window about 2.6 times as wide as the ground is tall.
	const ridgeW = $derived(
		width && height
			? Math.min(1200, Math.round((1200 * width) / height / 2.6))
			: 1200,
	);
	function placed(
		on: NonNullable<typeof frame>,
		ghost: { m: number; mps: number; label: string },
	) {
		const at = reverse ? stored.length - ghost.m : ghost.m;
		const here = perTick
			? at
			: Math.min(
					road.length,
					at + ghost.mps * Math.min(1, (now - secondAt) / 1000),
				);
		const x = here * on.scale;
		// Its name runs toward the strip's middle, so it never leaves the panel.
		return {
			x,
			y: yOf(on, heightAt(road, here)),
			early: x - shift < width / 2,
			label: ghost.label,
		};
	}
</script>

<div
	data-testid="skyline"
	data-along={Math.round(m)}
	role="img"
	aria-label="the road ahead: {((road.length - m) / 1000).toFixed(1)} km to go"
	class="in-[.flat-ground]:flat-sky relative h-full w-full overflow-hidden forced-colors:bg-[Canvas]"
>
	<!-- Flat, the Skyline is the ground (#4536): the world's ridges stand
	     behind the road, still as far hills are, drawn once. Over the 3D
	     world (a band) none of it is drawn: the world is the place there. -->
	<svg
		viewBox="0 0 {ridgeW} 100"
		preserveAspectRatio="none"
		class="pointer-events-none absolute inset-x-0 top-[16%] hidden h-[84%] w-full in-[.flat-ground]:block forced-colors:hidden"
		aria-hidden="true"
	>
		<path
			d="M0,100V40L70,26L130,34L210,12L290,30L350,22L430,4L520,28L600,20L680,32L760,8L850,26L920,18L1010,34L1090,14L1160,24L1200,20V100Z"
			class="fill-ridge-far"
		/>
		<path
			d="M0,100V50L90,38L170,46L260,30L360,44L450,34L540,48L640,32L730,42L830,28L930,40L1030,34L1120,44L1200,36V100Z"
			class="fill-ridge-near"
		/>
		<!-- The valley's floor before them, so a road low in its window
		     runs through meadow rather than under a wall. -->
		<path
			d="M0,100V66L160,62L340,68L520,63L700,69L880,62L1060,67L1200,64V100Z"
			class="fill-land"
		/>
	</svg>
	<!-- Flat, the profile stands on a foot of land, so the road never runs
	     along the screen's edge and its posts have room under it. -->
	<span
		class="bg-land-deep absolute inset-x-0 bottom-0 hidden h-[14%] in-[.flat-ground]:block forced-colors:hidden"
	></span>
	<div
		bind:clientWidth={width}
		bind:clientHeight={height}
		class="absolute inset-x-0 {tv
			? 'bottom-[2vh]'
			: 'bottom-3'} in-[.flat-ground]:bottom-[14%]"
		style:top={pad}
	>
		{#if frame}
			<div
				data-testid="skyline-road"
				class="absolute inset-y-0 left-0 will-change-transform"
				style:transform="translateX({-shift}px)"
			>
				{#each tiles as tile (tile.index)}
					{@const cut = Math.max(0, (dot?.x ?? 0) + shift - tile.left)}
					<svg
						width={tile.width}
						{height}
						style:left="{tile.left}px"
						class="absolute top-0 overflow-visible forced-color-adjust-none"
						aria-hidden="true"
					>
						<!-- Flat: the land under the road, which carries the grade,
						     and a deeper field below its verge. -->
						<path
							d={tile.land}
							class="fill-land hidden in-[.flat-ground]:block forced-colors:fill-[Canvas]"
						/>
						<path
							d={tile.land}
							transform="translate(0 {verge})"
							class="fill-land-deep hidden in-[.flat-ground]:block forced-colors:hidden"
						/>
						{#each tile.areas as area, step (step)}
							{#if area}<path
									d={area}
									class="{GRADE_FILL[
										step
									]} in-[.flat-ground]:hidden forced-colors:fill-[GrayText]"
								/>{/if}
						{/each}
						<!-- The road ridden is muted, the road ahead neon (TARGETS
					     ride-road-world 11): one line, cut at the dot. -->
						<clipPath id="{uid}-{tile.index}">
							<rect
								x={cut}
								y={-height}
								width={tile.width}
								height={height * 3}
							/>
						</clipPath>
						<clipPath id="{uid}-{tile.index}-r">
							<rect
								x={-tile.width}
								y={-height}
								width={tile.width + cut}
								height={height * 3}
							/>
						</clipPath>
						<!-- Flat: the road's bed, then the road ahead in its grade's
						     step, so the grade reads off the road itself. -->
						<path
							d={tile.line}
							fill="none"
							class="stroke-paper hidden in-[.flat-ground]:block forced-colors:stroke-[Canvas]"
							stroke-width={roadW + 4}
							stroke-linejoin="round"
						/>
						<g
							clip-path="url(#{uid}-{tile.index})"
							class="hidden in-[.flat-ground]:block"
						>
							{#each tile.roads as run, step (step)}
								{#if run}<path
										d={run}
										fill="none"
										class="{GRADE_STROKE[
											step
										]} forced-colors:stroke-[CanvasText]"
										stroke-width={roadW}
										stroke-linejoin="round"
									/>{/if}
							{/each}
						</g>
						<path
							d={tile.line}
							fill="none"
							clip-path="url(#{uid}-{tile.index}-r)"
							class="stroke-muted forced-colors:stroke-[GrayText]"
							stroke-width={tv ? 3 : 2}
						/>
						<path
							d={tile.line}
							fill="none"
							clip-path="url(#{uid}-{tile.index})"
							class="stroke-neon in-[.flat-ground]:hidden forced-colors:stroke-[CanvasText]"
							stroke-width={tv ? 3 : 2}
						/>
					</svg>
				{/each}
				{#if trailRuns.length}
					<!-- Your watts over the road ridden, each stretch in its zone's
					     colour (the watt colour without an FTP), no glow: the 3 s
					     power is the one that glows. -->
					<svg
						data-testid="skyline-watts"
						width="1"
						{height}
						class="pointer-events-none absolute top-0 left-0 overflow-visible"
						aria-hidden="true"
						>{#each trailRuns as run, i (i)}<polyline
								points={run.points}
								fill="none"
								stroke={run.stroke}
								stroke-width={tv ? 5 : 4}
								stroke-linejoin="round"
								stroke-linecap="round"
							/>{/each}</svg
					>
				{/if}
				{#each blocks as block, i (i)}
					<span
						class="{ZONE_BG[block.zone]} absolute bottom-0 h-1.5"
						style:left="{block.x}px"
						style:width="{block.width}px"
					></span>
				{/each}
				{#each chips as chip, i (i)}
					<span
						class="border-neon bg-surface text-ink absolute -mt-1 rounded border px-1 leading-none font-bold {tv
							? 'text-[3vh]'
							: 'text-sm'}"
						style:left="{chip.x}px"
						style:transform="translate({-100 *
							chipShift(chip.x - shift, width, chipEdge)}%, -100%)"
						style:top="{chip.y}px">{chip.cls}</span
					>
				{/each}
				{#if finishM !== undefined && frame && !strip}
					<!-- The finish, on a road drawn on past it: a chequered flag on a stake over the road. -->
					<span
						data-testid="skyline-finish"
						class="absolute top-0 left-0 flex -translate-x-1/2 flex-col items-center"
						style:transform="translate({finishM * frame.scale}px, {yOf(
							frame,
							heightAt(road, finishM),
						) - 44}px)"
					>
						<span
							class="num bg-ink text-surface px-1.5 py-0.5 text-[max(12px,1.6vh)] leading-none font-bold whitespace-nowrap"
							>FINISH</span
						>
						<span class="bg-ink block h-8 w-0.5"></span>
					</span>
				{/if}
				{#each posts as post (post.km)}
					<!-- A distance post (#4536): a stake under the road and its
					     kilometre, on the land; flat only. -->
					<span
						data-testid="skyline-post"
						class="absolute top-0 left-0 hidden -translate-x-1/2 flex-col items-center in-[.flat-ground]:flex"
						style:transform="translate({post.x}px, {post.y + roadW}px)"
					>
						<span class="bg-ink/60 block h-3 w-0.5"></span>
						<span
							class="num text-ink mt-0.5 leading-none font-bold whitespace-nowrap {tv
								? 'text-[2.6vh]'
								: 'text-[max(14px,1.8vh)]'}">{post.km} km</span
						>
					</span>
				{/each}
				{#each around as mate, i (i)}
					<!-- The riders around you (#4536): solid ink, as the world's
					     names are, never the watt colour (that is you) and no
					     glow. -->
					<span
						data-testid="skyline-mate"
						class="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 will-change-transform"
						style:transform="translate({mate.x}px, {mate.y}px)"
					>
						<span
							class="bg-ink border-surface block rounded-full border-2 forced-colors:bg-[CanvasText] {tv
								? 'size-[3vh]'
								: 'size-5'}"
						></span>
						<span
							data-testid="skyline-mate-label"
							class="text-ink bg-surface/85 absolute bottom-full mb-1.5 rounded px-1 leading-tight font-semibold whitespace-nowrap forced-colors:text-[CanvasText] {mate.early
								? 'left-1/2'
								: 'right-1/2'} {tv ? 'text-[3vh]' : 'text-[max(14px,1.8vh)]'}"
							>{mate.label}</span
						>
					</span>
				{/each}
				{#each haunts as haunt, i (i)}
					<!-- Your ghost, a hollow tick named for its day (#3245, #3615), and
					     the pacer named for its Category (#3281): neither is live, so
					     neither watt nor neon and no glow (ADR-0068). -->
					<span
						data-testid="skyline-ghost"
						class="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 will-change-transform"
						style:transform="translate({haunt.x}px, {haunt.y}px)"
					>
						<span
							class="border-ink/70 block rounded-full border-2 forced-colors:border-[CanvasText] {tv
								? 'size-[3vh]'
								: 'size-4'}"
						></span>
						<span
							data-testid="skyline-ghost-label"
							class="text-muted in-[.flat-ground]:bg-surface/85 absolute bottom-full mb-1 leading-none whitespace-nowrap in-[.flat-ground]:rounded in-[.flat-ground]:px-1 in-[.flat-ground]:py-0.5 forced-colors:text-[CanvasText] {haunt.early
								? 'left-1/2'
								: 'right-1/2'} {tv ? 'text-[3vh]' : 'text-sm'}"
							>{haunt.label}</span
						>
					</span>
				{/each}
			</div>
			{#if dot}
				<!-- The only glow: a halo painted once, never a filter (#2998). -->
				<span
					data-testid="skyline-dot"
					class="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 rounded-full will-change-transform forced-color-adjust-none forced-colors:bg-[Highlight] {tv
						? 'size-[4vh]'
						: 'size-6'}"
					style:transform="translate({dot.x}px, {dot.y}px)"
					style:background-image={HALO}
				></span>
			{/if}
		{/if}
	</div>
</div>
