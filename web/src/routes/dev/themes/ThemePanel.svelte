<!--
	One theme, painted for real (#399). The panel scopes the theme's own token
	declarations to itself and sets the colour-scheme its family implies, so
	everything inside — components, light-dark() pairs, the glow utilities —
	resolves exactly as it would if the rider had picked this theme. Nothing
	here fakes a colour.

	The surfaces are the ones the issue asks for, in a fixed order, because the
	comparison only works if the third row is the same row in every panel:
	chrome around live data, the whole ramp, TV numerals at size, the medal,
	then the gate's numbers under the thing they claim to be about.
-->
<script lang="ts">
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import MedalCard, { type Medal } from '$lib/components/MedalCard.svelte';
	import ZoneBar from '$lib/components/ZoneBar.svelte';
	import { plannedZoneSeconds } from '$lib/components/zones';
	import Sidebar from '$lib/nav/Sidebar.svelte';
	import { tokenDeclarations, type Theme } from '$lib/palette';
	import Instrument from '$lib/room/Instrument.svelte';
	import RiderTile from '$lib/room/RiderTile.svelte';
	import type { MockRider } from '$lib/room/mockcompat';
	import type { Segment } from '$lib/workout/types';
	import type { RailRoom } from '$lib/room/mockcompat';
	import { rampReadings, readings, ZONES, type Surface } from './gallery';

	let {
		theme,
		surface,
		riders,
		segments,
		total,
		elapsed,
		rooms,
		medal,
		narrow = false,
	}: {
		theme: Theme;
		surface: Surface;
		/** Live from the one shared mock room — every panel shows the same ride. */
		riders: MockRider[];
		segments: Segment[];
		total: number;
		elapsed: number;
		rooms: RailRoom[];
		medal: Medal;
		/** Laptop width: the room is more often on one than on a desk monitor. */
		narrow?: boolean;
	} = $props();

	const you = $derived(riders.find((rider) => rider.you) ?? riders[0]);
	const crew = $derived(riders.filter((rider) => !rider.you).slice(0, 2));
	const planned = $derived(plannedZoneSeconds(segments, you.ftp));
	const ramp = $derived(rampReadings(theme));
	const gate = $derived(readings(theme));

	const CAVE =
		'What a ride renders — the dark half of this identity, whatever the scheme says.';
	const DESK =
		'What the rooms list, the editor and the history look like under a light scheme.';
</script>

<section
	class="text-ink bg-surface border-edge overflow-hidden rounded-xl border"
	style="{tokenDeclarations(theme)}color-scheme: {theme.family === 'dark'
		? 'dark'
		: 'light'};"
>
	<header class="border-edge flex items-baseline gap-3 border-b px-4 py-3">
		<h3 class="font-display text-lg leading-none font-bold">{theme.name}</h3>
		<span class="eyebrow">{surface}</span>
		<span class="text-muted ml-auto font-mono text-[10px]">{theme.id}</span>
	</header>

	<p class="text-muted px-4 pt-3 text-xs leading-relaxed">
		{theme.note}
		<span class="text-muted/70 block">{surface === 'cave' ? CAVE : DESK}</span>
	</p>

	<div class="space-y-6 p-4">
		<!-- 1. Chrome around live data: the rail the room lives in, next to the
		     tile that carries the watts. ADR-0005's whole rule in one frame —
		     neon structures the rail, watt burns on your own number. -->
		<div>
			<span class="eyebrow">the rail and a live tile</span>
			<div class="mt-2 flex gap-3 overflow-x-auto">
				<!-- Standing in one room while the other is riding: the open room
				     carries neon's structural tint, the live one the watt radar
				     line. Both accents doing their own job, in one frame. -->
				<div
					class="border-edge h-[26rem] shrink-0 overflow-hidden rounded-lg border"
				>
					<Sidebar
						pathname="/r/sunday-long-ride"
						{rooms}
						activeSlug="sunday-long-ride"
						live
					/>
				</div>
				<div
					class="grid min-w-0 flex-1 gap-2 self-start {narrow
						? ''
						: 'grid-cols-2'}"
				>
					<RiderTile rider={you} phase="live" />
					{#each crew as rider (rider.id)}
						<RiderTile {rider} phase="live" />
					{/each}
				</div>
			</div>
		</div>

		<!-- 2. The whole ramp at once — where #396 showed the shipped one fell
		     apart. Every zone beside its neighbours, each with the contrast it
		     actually scores against this theme's surfaces. -->
		<div>
			<span class="eyebrow">the ramp, Z1 → Z7</span>
			<p class="text-muted/70 mt-1 text-[11px] leading-snug">
				Shared, not themed (ADR-0023 §4) — a zone reading is learned across the
				room. Only its fitting against these surfaces moves, and the numbers
				under each swatch are that fit.
			</p>
			<div class="mt-2 grid grid-cols-7 gap-px overflow-hidden rounded">
				{#each ZONES as zone, i (zone)}
					<div>
						<div
							class="h-10"
							style="background: var(--color-{zone})"
							title="Z{i + 1}"
						></div>
						<div class="text-muted pt-1 text-center font-mono text-[9px]">
							{ramp[i].toFixed(1)}
						</div>
					</div>
				{/each}
			</div>
			<div class="mt-3">
				<ZoneBar seconds={planned} legend />
			</div>
			<div class="mt-4">
				<IntervalGraph
					{segments}
					{total}
					{elapsed}
					ftp={you.ftp}
					trace={you.trace}
				/>
			</div>
		</div>

		<!-- 3. TV mode's own instrument, sized in vh exactly as the TV draws
		     it: the numerals are the surface most likely to be read from three
		     metres, and the only one where the glow is doing real work. -->
		<div>
			<span class="eyebrow">tv numerals, at size</span>
			<div class="bg-surface-raised mt-2 overflow-hidden rounded-lg p-4">
				<Instrument watts={you.watts} target={you.target} ftp={you.ftp} tv />
			</div>
		</div>

		<!-- 4. The medal: screenshot-first (WATTROOM.md), so it is the one
		     surface that leaves the app and has to hold up in a group chat. -->
		<div>
			<span class="eyebrow">medal card</span>
			<div class="mt-2">
				<MedalCard {medal} roomName="Thursday Sufferfest" />
			</div>
		</div>

		<!-- 5. The gate, beside the thing it is about. The numbers say legible;
		     everything above says whether it is any good. -->
		<div>
			<span class="eyebrow">contrast against this theme's surfaces</span>
			<ul class="mt-2 grid gap-1 text-xs">
				{#each gate as reading (reading.token)}
					<li class="flex items-baseline gap-2">
						<span
							class="h-2.5 w-2.5 shrink-0 rounded-full"
							style="background: var(--color-{reading.token})"
						></span>
						<span class="font-mono">{reading.token}</span>
						<span class="text-muted">{reading.job}</span>
						<span class="ml-auto font-mono tabular-nums">
							{reading.ratio.toFixed(2)}:1
						</span>
						<span
							class="font-mono text-[10px] {reading.passes
								? 'text-z4'
								: 'text-danger'}"
						>
							{reading.passes ? 'pass' : 'fail'} · {reading.floor}
						</span>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</section>
