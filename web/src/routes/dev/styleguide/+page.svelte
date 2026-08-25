<script lang="ts">
	const surfaces = [
		{ name: 'surface', hex: '#0a0a0f', use: 'page background' },
		{ name: 'surface-raised', hex: '#14141c', use: 'cards, tiles, nav' },
		{
			name: 'muted',
			hex: '#8b8b99',
			use: 'labels, secondary text, borders at low alpha',
		},
		{ name: 'watt', hex: '#f5d90a', use: 'live data only — never chrome' },
	];

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
	<h1 class="text-3xl font-semibold tracking-tight">Styleguide</h1>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		Tokens live in <code class="text-white/80">src/app.css</code>. Type scale
		renders in the chosen brand font once that's picked.
	</p>

	<!-- Surfaces -->
	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">
		Surfaces &amp; accent
	</h2>
	<div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		{#each surfaces as token (token.name)}
			<div class="border-muted/15 overflow-hidden rounded-lg border">
				<div class="h-20" style="background: {token.hex}"></div>
				<div class="bg-surface-raised px-4 py-3">
					<div class="font-mono text-xs">--color-{token.name}</div>
					<div class="text-muted mt-1 font-mono text-[11px]">{token.hex}</div>
					<div class="text-muted mt-2 text-xs">{token.use}</div>
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
				class="flex items-center gap-4 border-b border-white/5 px-4 py-2.5 last:border-0"
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
					<div class="text-5xl font-bold text-white tabular-nums">312</div>
					<div class="text-muted mt-1 text-[10px] tracking-wider uppercase">
						watts
					</div>
				</div>
				<button
					class="bg-watt glow-text rounded px-4 py-2 text-sm font-semibold text-black"
					>Start session</button
				>
			</div>
			<p class="text-muted mt-5 text-xs">
				The accent went to a button. Now nothing on screen says “this is live”.
			</p>
		</div>
	</div>

	<!-- Chrome components -->
	<h2 class="text-muted mt-12 text-xs tracking-[0.2em] uppercase">Chrome</h2>
	<div
		class="border-muted/15 bg-surface-raised mt-4 flex flex-wrap items-center gap-3 rounded-lg border p-6"
	>
		<button
			class="rounded bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
			>Primary</button
		>
		<button
			class="border-muted/30 hover:border-muted/60 rounded border px-4 py-2 text-sm"
			>Secondary</button
		>
		<button class="text-muted rounded px-4 py-2 text-sm hover:text-white"
			>Ghost</button
		>
		<button
			class="border-z6/40 text-z6 hover:bg-z6/10 rounded border px-4 py-2 text-sm"
			>Destructive</button
		>
		<input
			class="border-muted/25 placeholder:text-muted/60 focus:border-muted/60 rounded border bg-transparent px-3 py-2 text-sm outline-none"
			placeholder="Room name"
		/>
		<span
			class="border-muted/25 text-muted rounded-full border px-3 py-1 text-xs"
			>coach</span
		>
	</div>
</main>
