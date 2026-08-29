<script lang="ts">
	import { play } from '$lib/sound/cues';
	import { account } from '$lib/account.svelte';
	import {
		formatClock,
		ZONE_BG,
		ZONE_NAMES,
		ZONE_TEXT,
	} from '$lib/components/zones';
	import { createProfileStore } from '$lib/profile.svelte';
	import type { GameState, Rider } from '$lib/protocol';

	// One panel, seven heroes (#39's modes design): the server owns every rule;
	// this renders each mode's one load-bearing state. Vocabulary is SPEC's.
	let {
		game,
		roster,
		end,
		canControl,
	}: {
		game: GameState;
		roster: Rider[];
		end: () => void;
		canControl: boolean;
	} = $props();

	const profile = createProfileStore();
	const MODE_LABEL: Record<string, string> = {
		'backyard-ramp': 'Backyard Ramp',
		'collective-ramp': 'Collective Ramp',
		'floor-is-lava': 'Floor is Lava',
		'watt-golf': 'Watt Golf',
		'sprint-roulette': 'Sprint Roulette',
		'points-race': 'Points Race',
		'team-relay': 'Team Relay',
	};

	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(id);
	});
	const roundLeft = $derived(
		game.roundEndsAtMs ? Math.max(0, (game.roundEndsAtMs - now) / 1000) : 0,
	);

	const name = (id: string) => roster.find((r) => r.id === id)?.name ?? 'rider';
	const riderRows = $derived(Object.entries(game.riders ?? {}));
	const standing = $derived(
		[...riderRows].sort(([, a], [, b]) => (b.score ?? 0) - (a.score ?? 0)),
	);
	const alive = $derived(riderRows.filter(([, r]) => !r.eliminated));
	const out = $derived(riderRows.filter(([, r]) => r.eliminated));
	const front = $derived(riderRows.find(([, r]) => r.onFront));
	const zoneBounds = [
		'',
		'≤ 55 %',
		'56–75 %',
		'76–90 %',
		'91–105 %',
		'106–120 %',
		'121–150 %',
		'> 150 %',
	];
	const myGolfTarget = $derived(
		Math.round((game.linePct ?? 0) * profile.current.ftp),
	);
	const isRamp = $derived(
		game.mode === 'backyard-ramp' || game.mode === 'collective-ramp',
	);

	// Eliminations announce themselves — the rider is not watching the screen.
	let knownOut = new Set<string>();
	$effect(() => {
		for (const [id, rider] of riderRows) {
			if (rider.eliminated && !knownOut.has(id)) {
				knownOut.add(id);
				play('elimination');
			}
		}
		if (game.phase === 'done' && game.podium?.length) play('fanfare');
	});
</script>

<div class="border-neon/40 bg-surface-raised rounded-lg border-2 p-5">
	<div class="flex items-center gap-3">
		<span class="font-display font-bold"
			>{MODE_LABEL[game.mode] ?? game.mode}</span
		>
		{#if game.round && game.mode !== 'watt-golf'}
			<span class="text-muted text-xs">round {game.round}</span>
		{/if}
		{#if game.roundEndsAtMs && game.phase === 'running' && game.mode !== 'sprint-roulette'}
			<span class="text-muted font-mono text-xs tabular-nums"
				>{formatClock(Math.round(roundLeft))}</span
			>
		{/if}
		{#if canControl}
			<button
				onclick={end}
				class="border-muted/30 hover:border-muted/60 ml-auto rounded border px-3 py-1 text-xs"
				>End game</button
			>
		{/if}
	</div>

	{#if game.phase === 'done' && game.podium}
		<ol class="mt-4 grid gap-1.5">
			{#each game.podium.slice(0, 6) as score, i (score.riderId)}
				<li class="flex items-baseline gap-2 text-sm">
					<span class="text-muted w-6"
						>{['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`}</span
					>
					<span class="font-medium">{score.name}</span>
					{#if game.mode === 'sprint-roulette'}
						<span class="font-display ml-auto font-bold tabular-nums"
							>{score.wkg.toFixed(1)} w/kg</span
						>
					{:else if game.mode === 'watt-golf'}
						<span class="font-display ml-auto font-bold tabular-nums"
							>{Math.round(score.wkg)} strokes</span
						>
					{:else if game.mode === 'points-race'}
						<span class="font-display ml-auto font-bold tabular-nums"
							>{Math.round(score.wkg)} pts</span
						>
					{/if}
				</li>
			{/each}
		</ol>
	{:else if isRamp}
		<!-- Elimination: who is still in, and what the line is now. -->
		<div class="mt-4 flex flex-wrap items-baseline gap-6">
			<div>
				<div
					class="font-display text-watt glow-text text-4xl leading-none font-bold tabular-nums"
				>
					{Math.round((game.linePct ?? 0) * 100)}%
				</div>
				<p class="text-muted mt-1.5 text-[10px] tracking-wider uppercase">
					{game.mode === 'collective-ramp' ? 'room average line' : 'this round'}
				</p>
			</div>
			<div>
				<div class="font-display text-2xl leading-none font-bold tabular-nums">
					{alive.length}
				</div>
				<p class="text-muted mt-1.5 text-[10px] tracking-wider uppercase">
					still in
				</p>
			</div>
			{#if out.length > 0}
				<p class="text-muted self-center text-xs">
					out: {out.map(([id]) => name(id)).join(', ')} — spinning at 50 %
				</p>
			{/if}
		</div>
	{:else if game.mode === 'floor-is-lava'}
		<div class="mt-4 flex flex-wrap items-baseline gap-4">
			<span
				class="font-display text-2xl font-bold {ZONE_TEXT[
					game.calledZone ?? 2
				]}">Z{game.calledZone} {ZONE_NAMES[game.calledZone ?? 2]}</span
			>
			<span class="text-muted text-xs"
				>{zoneBounds[game.calledZone ?? 2]} FTP</span
			>
			<span class="text-muted ml-auto text-xs"
				>zone changes when the clock runs out</span
			>
		</div>
		<div class="mt-3 flex flex-wrap gap-2">
			{#each riderRows as [id, rider] (id)}
				<span
					class="rounded-full border px-2.5 py-1 text-xs {rider.eliminated
						? 'border-z6/40 text-z6 line-through'
						: 'border-muted/20'}"
				>
					{name(id)} · {'♥'.repeat(Math.max(0, rider.lives ?? 0))}
				</span>
			{/each}
		</div>
	{:else if game.mode === 'watt-golf'}
		<!-- The whole mode is the absence of a meter. -->
		<div class="mt-4 text-center">
			<p class="text-muted text-[10px] tracking-[0.2em] uppercase">
				hole {game.round} of 9
			</p>
			<div
				class="font-display mt-2 text-5xl leading-none font-bold tabular-nums"
			>
				{myGolfTarget} W
			</div>
			{#if game.meterHidden}
				<div
					class="border-muted/25 text-muted mt-3 inline-block rounded border border-dashed px-3 py-1.5 text-xs"
				>
					your power is hidden until the hole ends
				</div>
			{/if}
			<p class="text-muted mt-4 font-mono text-xs tabular-nums">
				strokes so far: {Math.round(
					game.riders?.[account.me?.id ?? '']?.score ?? 0,
				)}
			</p>
		</div>
	{:else if game.mode === 'sprint-roulette'}
		<div class="mt-4 text-center">
			<p class="text-muted text-[10px] tracking-[0.2em] uppercase">
				{game.roundEndsAtMs && game.roundEndsAtMs > now
					? 'sprint!'
					: 'next sprint'}
			</p>
			<div
				class="font-display text-watt glow-text-strong mt-2 text-6xl leading-none font-bold"
			>
				{#if game.roundEndsAtMs && game.roundEndsAtMs > now}
					{Math.ceil((game.roundEndsAtMs - now) / 1000)}
				{:else}
					?
				{/if}
			</div>
			<p class="text-muted mt-3 text-xs">
				Somewhere in the next 3–8 minutes. The klaxon gives you 3 seconds.
			</p>
			<div class="mt-6 grid grid-cols-3 gap-3">
				{#each standing.slice(0, 3) as [id, rider], i (id)}
					<div class="bg-surface rounded p-3">
						<p class="text-muted text-[10px] uppercase">best {i + 1}</p>
						<p class="font-display mt-1 font-bold">{name(id)}</p>
						<p class="font-mono text-xs tabular-nums">
							{(rider.score ?? 0).toFixed(1)} w/kg
						</p>
					</div>
				{/each}
			</div>
		</div>
	{:else if game.mode === 'points-race'}
		<ul class="mt-4 space-y-2">
			{#each standing as [id, rider], i (id)}
				<li class="flex items-center gap-3">
					<span class="text-muted w-5 font-mono text-xs tabular-nums"
						>{i + 1}</span
					>
					<span class="w-20 truncate text-sm">{name(id)}</span>
					<div class="bg-surface h-2 flex-1 overflow-hidden rounded-full">
						<div
							class="{ZONE_BG[4]} h-full rounded-full"
							style="width: {((rider.score ?? 0) /
								Math.max(1, standing[0]?.[1].score ?? 1)) *
								100}%"
						></div>
					</div>
					<span class="font-display w-8 text-right font-bold tabular-nums"
						>{Math.round(rider.score ?? 0)}</span
					>
				</li>
			{/each}
		</ul>
		<p class="text-muted mt-4 text-[11px]">
			Sprint 5/3/2/1 · cleanest interval 3 · in-zone streak 1
		</p>
	{:else if game.mode === 'team-relay'}
		<!-- Team Relay: one number the whole room owns. -->
		<div class="mt-4 flex flex-wrap items-baseline gap-6">
			<div>
				<p class="text-muted text-[10px] tracking-[0.2em] uppercase">
					on the front
				</p>
				<p class="font-display text-watt glow-text mt-1 text-2xl font-bold">
					{front ? name(front[0]) : '—'}
				</p>
				<p class="text-muted mt-1 text-xs">
					110 % FTP · rest sit at 55 % · rotates in {formatClock(
						Math.round(roundLeft),
					)}
				</p>
			</div>
			<div class="ml-auto text-right">
				<p class="text-muted text-[10px] tracking-[0.2em] uppercase">
					room distance
				</p>
				<p class="font-display mt-1 text-2xl font-bold tabular-nums">
					{Math.round((game.roomDistance ?? 0) / 1000)} kJ
				</p>
			</div>
		</div>
	{/if}
</div>
