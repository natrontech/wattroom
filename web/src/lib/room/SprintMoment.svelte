<script lang="ts">
	import { play, playCountdownTick } from '$lib/sound/cues';
	import type { SprintState } from '$lib/protocol';
	import type { RoomRider } from '$lib/room/view';
	import { PLACES } from '$lib/room/podium';
	import { wkg } from '$lib/format';

	// The sprint moment overlay (#30): klaxon countdown, the 15 s window, the
	// mini-podium. Times come as server-clock anchors; local now is close
	// enough for display (the scoring happens server-side).
	let {
		sprint,
		myWatts,
		roster = [],
		silent = false,
	}: {
		sprint: SprintState;
		myWatts: number;
		/** The room, for the live standings — absent outside a room. */
		roster?: RoomRider[];
		/** The /dev gallery mounts this without a ride — no klaxon there. */
		silent?: boolean;
	} = $props();

	// Ranked on w/kg, the fair ordering for mixed groups (docs/SPEC.md).
	const ranked = $derived(
		[...roster].sort((a, b) => b.watts / b.kg - a.watts / a.kg),
	);
	const leader = $derived(
		ranked.length > 0 ? ranked[0].watts / ranked[0].kg : 0,
	);

	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 100);
		return () => clearInterval(id);
	});

	const phase = $derived(
		now < sprint.startsAtMs
			? 'klaxon'
			: now < sprint.endsAtMs
				? 'live'
				: 'podium',
	);
	const countdown = $derived(Math.ceil((sprint.startsAtMs - now) / 1000));
	const remaining = $derived(Math.max(0, (sprint.endsAtMs - now) / 1000));

	// The klaxon grabs attention once when the sprint arms; the last two
	// seconds reuse the rising countdown ticks, then the gun.
	let heard = $state<string | null>(null);
	let heardSecond = -1;
	$effect(() => {
		if (silent) return;
		if (phase === 'klaxon' && countdown !== heardSecond) {
			heardSecond = countdown;
			if (heard === null) {
				heard = 'klaxon';
				play('klaxon');
			} else if (countdown > 0 && countdown <= 2) {
				playCountdownTick(countdown);
			}
		}
		if (phase === 'live' && heard === 'klaxon') {
			heard = 'go';
			play('go');
		}
		if (phase === 'podium' && heard === 'go') {
			heard = 'podium';
			play('fanfare');
		}
	});
</script>

<!-- ADR-0020: the sprint takes the focus and gives it back. This was a card
     appended under the dashboard — the quietest element on screen for the
     loudest fifteen seconds in the product, which WATTROOM.md calls the one
     place the UI is allowed to go loud. `roster` absent keeps the old compact
     rendering for /dev/modes, which mounts it without a room. -->
{#if phase === 'klaxon'}
	<div class="grid h-full place-items-center">
		<div class="text-center">
			<p class="eyebrow">get ready</p>
			<p
				class="font-display text-watt glow-text-strong text-[9rem] leading-none font-bold tabular-nums"
			>
				{Math.max(0, countdown)}
			</p>
			<p class="font-display mt-2 text-3xl font-bold">SPRINT</p>
			<p class="text-muted mt-1 text-sm">
				15 seconds, all out — your trainer lets go of the target
			</p>
		</div>
	</div>
{:else if phase === 'live'}
	<div class="grid h-full min-h-0 grid-rows-[auto_1fr] gap-4">
		<div class="flex items-end gap-6">
			<div>
				<p class="eyebrow">all out</p>
				<p
					class="font-display text-watt glow-text-strong text-8xl leading-none font-bold tabular-nums"
				>
					{myWatts}
				</p>
			</div>
			<div class="ml-auto pb-2 text-right">
				<p class="eyebrow">left</p>
				<p class="font-display text-5xl leading-none font-bold tabular-nums">
					{remaining.toFixed(1)}
				</p>
			</div>
		</div>

		{#if ranked.length > 0}
			<!-- A sprint is a contest, so the crew stops being context and becomes
			     the scoreboard. Ranked on w/kg — a 62 kg climber and a 78 kg
			     sprinter are not racing the same number (docs/SPEC.md's rule for
			     every contest here). -->
			<ol class="min-h-0 space-y-1.5 overflow-y-auto">
				{#each ranked as rider, i (rider.id)}
					<li
						class="flex items-center gap-3 rounded px-3 py-3 {rider.you
							? 'bg-surface-raised'
							: ''}"
					>
						<span
							class="font-display text-muted w-8 shrink-0 text-xl font-bold tabular-nums"
							>{i + 1}</span
						>
						<span
							class="min-w-0 flex-1 truncate text-lg {rider.you
								? 'font-semibold'
								: ''}">{rider.name}</span
						>
						<span
							class="bg-surface hidden h-3 w-48 shrink-0 overflow-hidden rounded-full sm:block"
						>
							<span
								class="bg-watt block h-full transition-[width] duration-300"
								style="width: {leader > 0
									? Math.min(100, (rider.watts / rider.kg / leader) * 100)
									: 0}%"
							></span>
						</span>
						<span
							class="font-display w-24 shrink-0 text-right text-3xl font-bold tabular-nums {i ===
							0
								? 'text-watt glow-text'
								: ''}">{wkg(rider.watts, rider.kg)}</span
						>
						<span
							class="text-muted w-16 shrink-0 text-right text-sm tabular-nums"
							>{rider.watts} W</span
						>
					</li>
				{/each}
			</ol>
		{/if}
	</div>
{:else if sprint.results}
	<div class="grid h-full place-items-center">
		<div class="w-full max-w-lg text-center">
			<p class="eyebrow">sprint podium</p>
			<ol class="mt-4 space-y-2">
				{#each sprint.results.slice(0, 3) as score, i (score.riderId)}
					{@const place = PLACES[i]}
					<li
						class="flex items-center gap-3 rounded-lg px-4 py-3 {i === 0
							? 'border-watt/40 border-2'
							: 'bg-surface-raised'}"
					>
						<place.icon
							size={28}
							class="shrink-0 {place.tone}"
							aria-label={place.label}
						/>
						<span class="flex-1 truncate text-left font-medium"
							>{score.name}</span
						>
						<span
							class="font-display text-2xl font-bold tabular-nums {i === 0
								? 'text-watt glow-text-strong'
								: ''}">{score.wkg.toFixed(1)}</span
						>
						<span class="text-muted text-xs">w/kg</span>
					</li>
				{/each}
			</ol>
			<p class="text-muted mt-4 text-xs">
				Back to the workout — targets return in a moment.
			</p>
		</div>
	</div>
{/if}
