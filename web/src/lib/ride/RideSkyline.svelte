<script lang="ts">
	/**
	 * A saved road ride's Skyline (#3639): the road it rode, whole and still,
	 * from its own metres and heights — the profile in the Skyline's five
	 * grade steps and its climbs by class where they top out. No dot: the
	 * ride is over, and nothing here is live, so nothing glows.
	 */
	import { formatKm } from '$lib/format';
	import { climbsOf } from '$lib/road/climbs';
	import { chipsIn, GRADE_FILL, tileOf } from '$lib/road/skyline';
	import { rideProfile, wholeRoadFrame } from './ride-profile';

	let { samples }: { samples: readonly { m?: number; alt?: number }[] } =
		$props();

	// A viewBox, never a pixel width on an SVG the page measures (ux.md).
	const W = 1000;
	const H = 120;
	const road = $derived(rideProfile(samples));
	const drawn = $derived.by(() => {
		if (!road) return null;
		const frame = wholeRoadFrame(road, W, H);
		return {
			tile: tileOf(frame, road, 0),
			chips: chipsIn(frame, road, climbsOf(road)),
		};
	});
</script>

{#if road && drawn}
	<section class="panel panel-xl mt-3" aria-label="the road you rode">
		<h2 class="eyebrow">the road</h2>
		<p class="text-muted mt-0.5 mb-4 text-xs">
			{formatKm(road.length)} km, as you rode it — laps and all.
		</p>
		<div
			class="relative h-32"
			data-testid="ride-skyline"
			role="img"
			aria-label="the road's profile, {formatKm(road.length)} km"
		>
			<svg
				viewBox="0 0 {W} {H}"
				width="100%"
				height="100%"
				preserveAspectRatio="none"
				class="forced-color-adjust-none"
				aria-hidden="true"
			>
				{#each drawn.tile.areas as area, step (step)}
					{#if area}<path
							d={area}
							class="{GRADE_FILL[step]} forced-colors:fill-[GrayText]"
						/>{/if}
				{/each}
				<path
					d={drawn.tile.line}
					fill="none"
					class="stroke-neon forced-colors:stroke-[CanvasText]"
					stroke-width="2"
					vector-effect="non-scaling-stroke"
				/>
			</svg>
			{#each drawn.chips as chip, i (i)}
				<span
					class="border-neon bg-surface text-ink absolute -mt-1 -translate-x-1/2 -translate-y-full rounded border px-1 text-sm leading-none font-bold"
					style:left="{(chip.x / W) * 100}%"
					style:top="{(chip.y / H) * 100}%">{chip.cls}</span
				>
			{/each}
		</div>
	</section>
{/if}
