<script lang="ts">
	import { play } from '$lib/sound/cues';
	import Logo from '$lib/brand/Logo.svelte';
	import MedalCard, { type Medal } from '$lib/components/MedalCard.svelte';
	import {
		formatClock,
		ROOM_NAME,
		workout,
		ZONE_BG,
		ZONE_NAMES,
	} from '../room/mockRoom.svelte';

	// Every number here is a docs/SPEC.md formula, not an invented one.
	const ride = {
		seconds: 3900,
		kj: 812,
		execution: 0.94,
		avgWatts: 208,
		normalised: 221,
		level: { n: 22, xpInto: 1840, xpNeeded: 2600 },
		xp: { base: 812, execution: 47, streak: 100 },
		category: { from: 'C', to: 'B', wkg: 3.28 },
	};

	// Seconds in each zone — the shape of the ride at a glance.
	const zoneSeconds = [0, 240, 780, 1980, 660, 180, 60, 0];
	const totalZoneSeconds = zoneSeconds.reduce((a, b) => a + b, 0);

	const curve = [
		{ label: '5 s', watts: 742, best: true },
		{ label: '1 min', watts: 418, best: false },
		{ label: '5 min', watts: 301, best: true },
		{ label: '20 min', watts: 259, best: false },
	];

	const totalXp = ride.xp.base + ride.xp.execution + ride.xp.streak;

	// A medal and a category promotion both announce themselves (SPEC: demotions do not).
	$effect(() => play('fanfare'));

	const medal: Medal = {
		name: 'Metronome',
		criterion: 'best execution score',
		rider: 'You',
		value: '94',
		unit: '%',
		kj: ride.kj,
		xp: totalXp,
	};
</script>

<main class="mx-auto max-w-5xl px-6 py-10">
	<header class="flex items-center gap-3">
		<Logo size={30} />
		<div>
			<h1 class="font-display text-2xl leading-tight font-bold">
				Session complete
			</h1>
			<p class="text-muted text-xs">
				{ROOM_NAME} · {workout.name} · 25 Aug 2026
			</p>
		</div>
	</header>

	<!-- Headline numbers first: what you did, how well, what it earned. -->
	<section class="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		{#each [{ label: 'duration', value: formatClock(ride.seconds) }, { label: 'work', value: `${ride.kj} kJ` }, { label: 'execution', value: `${Math.round(ride.execution * 100)}%` }, { label: 'normalised', value: `${ride.normalised} W` }] as stat (stat.label)}
			<div class="border-muted/15 bg-surface-raised rounded-lg border p-5">
				<div class="font-display text-3xl leading-none font-bold tabular-nums">
					{stat.value}
				</div>
				<div class="text-muted mt-2 text-[10px] tracking-wider uppercase">
					{stat.label}
				</div>
			</div>
		{/each}
	</section>

	<div class="mt-3 grid gap-3 lg:grid-cols-[1fr_400px]">
		<div class="grid gap-3">
			<!-- Time in zone -->
			<section class="border-muted/15 bg-surface-raised rounded-lg border p-5">
				<h2 class="text-muted text-[10px] tracking-[0.2em] uppercase">
					time in zone
				</h2>
				<div class="mt-4 flex h-3 overflow-hidden rounded-full">
					{#each zoneSeconds as seconds, zone (zone)}
						{#if seconds > 0}
							<div
								class={ZONE_BG[zone]}
								style="width: {(seconds / totalZoneSeconds) * 100}%"
								title="{ZONE_NAMES[zone]}: {formatClock(seconds)}"
							></div>
						{/if}
					{/each}
				</div>
				<ul class="mt-4 grid gap-1.5 sm:grid-cols-2">
					{#each zoneSeconds as seconds, zone (zone)}
						{#if seconds > 0}
							<li class="flex items-center gap-2 text-xs">
								<span class="h-2 w-2 shrink-0 rounded-full {ZONE_BG[zone]}"
								></span>
								<span class="text-muted">Z{zone} {ZONE_NAMES[zone]}</span>
								<span class="ml-auto font-mono tabular-nums"
									>{formatClock(seconds)}</span
								>
							</li>
						{/if}
					{/each}
				</ul>
			</section>

			<!-- Power curve -->
			<section class="border-muted/15 bg-surface-raised rounded-lg border p-5">
				<h2 class="text-muted text-[10px] tracking-[0.2em] uppercase">
					power curve
				</h2>
				<div class="mt-4 grid grid-cols-4 gap-3">
					{#each curve as point (point.label)}
						<div>
							<div
								class="font-display text-2xl leading-none font-bold tabular-nums"
							>
								{point.watts}
							</div>
							<div class="text-muted mt-1 text-[10px] tracking-wider uppercase">
								{point.label}
							</div>
							{#if point.best}
								<div
									class="text-watt mt-1 text-[10px] tracking-wider uppercase"
								>
									90-day best
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</section>

			<!-- XP + level + category, each traceable to a SPEC formula -->
			<section class="border-muted/15 bg-surface-raised rounded-lg border p-5">
				<div class="flex items-baseline gap-3">
					<h2 class="text-muted text-[10px] tracking-[0.2em] uppercase">
						progress
					</h2>
					<span class="text-muted ml-auto font-mono text-[11px] tabular-nums"
						>+{totalXp} XP</span
					>
				</div>
				<div class="mt-3 flex items-baseline gap-2">
					<span class="font-display text-2xl font-bold"
						>Level {ride.level.n}</span
					>
					<span class="text-muted font-mono text-[11px] tabular-nums"
						>{ride.level.xpInto} / {ride.level.xpNeeded}</span
					>
				</div>
				<div class="bg-surface mt-2 h-2 overflow-hidden rounded-full">
					<div
						class="bg-neon h-full rounded-full"
						style="width: {(ride.level.xpInto / ride.level.xpNeeded) * 100}%"
					></div>
				</div>
				<ul
					class="text-muted mt-3 space-y-1 font-mono text-[11px] tabular-nums"
				>
					<li class="flex">
						<span>{ride.kj} kJ ridden</span><span class="ml-auto"
							>+{ride.xp.base}</span
						>
					</li>
					<li class="flex">
						<span>execution bonus</span><span class="ml-auto"
							>+{ride.xp.execution}</span
						>
					</li>
					<li class="flex">
						<span>4-week streak</span><span class="ml-auto"
							>+{ride.xp.streak}</span
						>
					</li>
				</ul>
				<!-- SPEC: category rises announce in the room; drops happen silently. -->
				<div class="border-z4/40 bg-z4/10 mt-4 rounded border px-3 py-2">
					<p class="text-z4 text-xs font-medium">
						Category {ride.category.from} → {ride.category.to}
					</p>
					<p class="text-muted mt-0.5 text-[11px]">
						Best 20-min over 90 days is now {ride.category.wkg} w/kg.
					</p>
				</div>
			</section>
		</div>

		<div>
			<h2 class="text-muted text-[10px] tracking-[0.2em] uppercase">
				your medal
			</h2>
			<div class="mt-3">
				<MedalCard {medal} roomName={ROOM_NAME} />
			</div>
			<div class="border-muted/15 mt-3 rounded-lg border p-4">
				<label class="flex items-start gap-3">
					<input type="checkbox" class="mt-0.5" />
					<span>
						<span class="block text-sm">Share this ride with the room</span>
						<span class="text-muted block text-xs">
							Rides are private by default. Sharing puts your numbers and this
							card on the room's history — it never shares your heart rate.
						</span>
					</span>
				</label>
			</div>

			<div class="mt-3 flex gap-2">
				<button
					class="flex-1 rounded bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-white/90"
					>Save card</button
				>
				<button
					class="border-muted/30 hover:border-muted/60 flex-1 rounded border px-4 py-2.5 text-sm"
					>Export .fit</button
				>
			</div>
		</div>
	</div>
</main>
