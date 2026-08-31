<script lang="ts">
	import { TOKENS, type Theme } from '$lib/palette';
	import { THEMES } from '$lib/themes';

	function themeStyle(theme: Theme): string {
		return [
			`color-scheme: ${theme.family === 'dark' ? 'dark' : 'light'}`,
			...TOKENS.map((token) => `--color-${token}: ${theme.tokens[token]}`),
		].join(';');
	}

	const surfaces = [
		{ name: 'surface', cls: 'bg-surface', use: 'page background' },
		{
			name: 'surface-raised',
			cls: 'bg-surface-raised',
			use: 'cards, tiles, nav',
		},
		{
			name: 'muted',
			cls: 'bg-muted',
			use: 'labels, secondary text, borders at low alpha',
		},
		{
			name: 'neon',
			cls: 'bg-neon',
			use: 'horizons, grids, mark accents — structural, never glows',
		},
		{ name: 'watt', cls: 'bg-watt', use: 'live data only — never chrome' },
	];

	// Swatches read their own resolved colour, so switching palette relabels them.
	let swatches = $state<HTMLElement[]>([]);
	let resolved = $state<string[]>([]);
	$effect(() => {
		resolved = swatches.map((el) =>
			el ? getComputedStyle(el).backgroundColor : '',
		);
	});

	// Coggan 7-zone. Boundaries are the standard model; colours deliberately skip yellow.
	const zones = [
		{ n: 1, name: 'Active recovery', pct: '≤55%', cls: 'bg-z1' },
		{ n: 2, name: 'Endurance', pct: '56–75%', cls: 'bg-z2' },
		{ n: 3, name: 'Tempo', pct: '76–90%', cls: 'bg-z3' },
		{ n: 4, name: 'Threshold', pct: '91–105%', cls: 'bg-z4' },
		{ n: 5, name: 'VO₂ max', pct: '106–120%', cls: 'bg-z5' },
		{ n: 6, name: 'Anaerobic', pct: '121–150%', cls: 'bg-z6' },
		{ n: 7, name: 'Neuromuscular', pct: '>150%', cls: 'bg-z7' },
	];

	const glows = [
		{ cls: '', name: 'none', use: 'chrome, static numbers, anything not live' },
		{
			cls: 'glow-text',
			name: 'glow-text',
			use: 'live metrics on a dashboard tile',
		},
		{
			cls: 'glow-text-strong',
			name: 'glow-text-strong',
			use: 'sprint moments, your own big number',
		},
	];
</script>

<main class="mx-auto max-w-5xl px-6 py-12">
	<h1 class="font-display text-3xl font-bold tracking-tight">Styleguide</h1>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		Tokens live in <code class="text-ink/80">src/app.css</code>; the identity
		that fixes their values is ADR-0005.
	</p>

	<!-- Surfaces -->
	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Surfaces &amp; accent
	</h2>
	<div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
		{#each surfaces as token, i (token.name)}
			<div class="border-muted/15 overflow-hidden rounded-lg border">
				<div class="h-20 {token.cls}" bind:this={swatches[i]}></div>
				<div class="bg-surface-raised px-4 py-3">
					<div class="font-mono text-xs">--color-{token.name}</div>
					<div class="text-muted mt-1 font-mono text-[11px]">
						{resolved[i] ?? ''}
					</div>
					<div class="text-muted mt-2 text-xs">{token.use}</div>
				</div>
			</div>
		{/each}
	</div>

	<!-- Every catalogue entry, rendered under its own complete token set. -->
	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Full theme catalogue
	</h2>
	<p class="text-muted mt-2 max-w-2xl text-xs">
		Each card overrides all colour tokens. The live wattage is the right use of
		glow; glowing structural chrome is deliberately shown as the wrong use.
	</p>
	<div class="mt-4 grid gap-3 md:grid-cols-2">
		{#each THEMES as theme (theme.id)}
			<div
				class="border-muted/25 bg-surface text-ink overflow-hidden rounded-lg border"
				style={themeStyle(theme)}
			>
				<div class="bg-surface-raised p-5">
					<div class="flex items-start justify-between gap-4">
						<div>
							<div class="font-display font-bold">{theme.name}</div>
							<div class="text-muted mt-1 text-xs">{theme.note}</div>
						</div>
						<span
							class="border-muted/30 text-muted rounded border px-2 py-1 font-mono text-[10px] uppercase"
						>
							{theme.family}
						</span>
					</div>
					<div class="mt-5 grid grid-cols-2 gap-3">
						<div class="border-muted/20 rounded border p-3">
							<div class="text-z4 text-[10px] font-semibold uppercase">
								Right
							</div>
							<div
								class="text-watt glow-text mt-2 text-4xl font-bold tabular-nums"
							>
								312
							</div>
							<div class="text-muted text-[10px] uppercase">live watts</div>
						</div>
						<div class="border-muted/20 rounded border p-3">
							<div class="text-z6 text-[10px] font-semibold uppercase">
								Wrong
							</div>
							<div class="text-neon glow-text mt-2 text-4xl font-bold">
								Grid
							</div>
							<div class="text-muted text-[10px] uppercase">
								chrome must stay flat
							</div>
						</div>
					</div>
				</div>
				<div class="grid grid-cols-7">
					{#each zones as zone (zone.n)}
						<div class="{zone.cls} h-3" title="Z{zone.n}"></div>
					{/each}
				</div>
			</div>
		{/each}
	</div>

	<!-- Zones -->
	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Power zones
	</h2>
	<div class="border-muted/15 mt-4 overflow-hidden rounded-lg border">
		{#each zones as zone (zone.n)}
			<div
				class="border-ink/5 flex items-center gap-4 border-b px-4 py-2.5 last:border-0"
			>
				<div class="h-6 w-10 rounded {zone.cls}"></div>
				<div class="w-8 font-mono text-xs">Z{zone.n}</div>
				<div class="flex-1 text-sm">{zone.name}</div>
				<div class="text-muted font-mono text-xs tabular-nums">
					{zone.pct} FTP
				</div>
			</div>
		{/each}
	</div>

	<!-- Glow scale -->
	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Glow scale
	</h2>
	<div class="mt-4 grid gap-3 sm:grid-cols-3">
		{#each glows as glow (glow.name)}
			<div class="border-muted/15 bg-surface-raised rounded-lg border p-6">
				<div class="text-watt text-6xl font-bold tabular-nums {glow.cls}">
					312
				</div>
				<div class="mt-4 font-mono text-xs">{glow.name || '—'}</div>
				<div class="text-muted mt-1 text-xs">{glow.use}</div>
			</div>
		{/each}
	</div>
	<div class="border-muted/15 bg-surface-raised mt-3 rounded-lg border p-6">
		<svg viewBox="0 0 400 60" class="text-z4 glow-stroke h-16 w-full">
			<polyline
				points="0,48 40,44 80,20 120,24 160,18 200,40 240,16 280,20 320,44 360,12 400,16"
				fill="none"
				stroke="currentColor"
				stroke-width="3"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
		<div class="mt-3 font-mono text-xs">glow-stroke</div>
		<div class="text-muted mt-1 text-xs">
			Power traces and interval graphs. Inherits the zone colour via
			currentColor.
		</div>
	</div>

	<!-- The restraint rule, made concrete -->
	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Data glows, chrome doesn't
	</h2>
	<div class="mt-4 grid gap-3 sm:grid-cols-2">
		<div class="border-z4/40 bg-surface-raised rounded-lg border p-6">
			<div class="text-z4 text-xs font-medium tracking-wider uppercase">
				Right
			</div>
			<div class="mt-5 flex items-end gap-6">
				<div>
					<div class="text-watt glow-text text-5xl font-bold tabular-nums">
						312
					</div>
					<div class="text-muted mt-1 text-[10px] tracking-wider uppercase">
						watts
					</div>
				</div>
				<button
					class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
					>Start session</button
				>
			</div>
			<p class="text-muted mt-5 text-xs">
				Live wattage glows. The button is flat and quiet.
			</p>
		</div>
		<div class="border-z6/40 bg-surface-raised rounded-lg border p-6">
			<div class="text-z6 text-xs font-medium tracking-wider uppercase">
				Wrong
			</div>
			<div class="mt-5 flex items-end gap-6">
				<div>
					<div class="text-ink text-5xl font-bold tabular-nums">312</div>
					<div class="text-muted mt-1 text-[10px] tracking-wider uppercase">
						watts
					</div>
				</div>
				<button
					class="bg-watt glow-text text-paper rounded px-4 py-2 text-sm font-semibold"
					>Start session</button
				>
			</div>
			<p class="text-muted mt-5 text-xs">
				The accent went to a button. Now nothing on screen says “this is live”.
			</p>
		</div>
	</div>

	<!-- Chrome components: the kit utilities from app.css. These ARE the
	     definitions — never retype the class strings at a call site. -->
	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">Chrome</h2>
	<div class="panel mt-4 flex flex-wrap items-center gap-3 p-6">
		<button class="btn btn-primary">Primary</button>
		<button class="btn btn-secondary">Secondary</button>
		<button class="btn btn-ghost">Ghost</button>
		<button class="btn btn-danger">Destructive</button>
		<button class="btn btn-accent">Go live</button>
		<button class="btn btn-primary btn-xs">Compact</button>
		<button class="btn btn-secondary btn-lg">Big tap target</button>
		<button class="btn btn-primary" disabled>Disabled</button>
		<input class="input" placeholder="Room name" />
		<span
			class="border-muted/25 text-muted rounded-full border px-3 py-1 text-xs"
			>coach</span
		>
	</div>
	<p class="text-muted mt-3 max-w-2xl text-xs">
		<code class="text-ink/80">btn</code> + variant (+
		<code class="text-ink/80">btn-xs</code>/<code class="text-ink/80"
			>btn-lg</code
		>), <code class="text-ink/80">input</code>,
		<code class="text-ink/80">panel</code>,
		<code class="text-ink/80">eyebrow</code>,
		<code class="text-ink/80">page</code> — defined once in app.css. Icons are
		Lucide (<code class="text-ink/80">@lucide/svelte</code>), not unicode
		glyphs.
	</p>
</main>
