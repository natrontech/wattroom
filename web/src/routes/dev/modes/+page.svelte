<script lang="ts">
	import {
		formatClock,
		ZONE_BG,
		ZONE_NAMES,
		ZONE_TEXT,
	} from '../room/mockRoom.svelte';

	/**
	 * Seven rule modules over the same workout engine. Every parameter here comes from
	 * docs/SPEC.md's game-mode table — the point of the page is the UI state each mode
	 * needs, not new rules.
	 */
	const modes = [
		{
			id: 'backyard',
			name: 'Backyard Ramp',
			rule: '3-min rounds, start 80 % FTP, +5 %/round. Ten seconds below band and you are out.',
		},
		{
			id: 'lava',
			name: 'Floor is Lava',
			rule: 'Hold the called zone. Out of it for more than 5 s burns a life. Three lives, zone changes every 2 min.',
		},
		{
			id: 'golf',
			name: 'Watt Golf',
			rule: 'Hit the number for 10 s with the meter hidden. Strokes are your mean deviation in watts.',
		},
		{
			id: 'roulette',
			name: 'Sprint Roulette',
			rule: '10–15 s sprints at random 3–8 min gaps, klaxon 3 s before. Best 5 s w/kg wins.',
		},
		{
			id: 'points',
			name: 'Points Race',
			rule: 'Sprints pay 5/3/2/1. Best interval execution pays 3. Time-in-zone streak pays 1.',
		},
		{
			id: 'relay',
			name: 'Team Relay',
			rule: 'One rider on the front at 110 % FTP while the rest sit at 55 %. Rotate on the timer or call it.',
		},
		{
			id: 'collective',
			name: 'Collective Ramp',
			rule: 'Backyard rules on the room average. Line starts 75 %, +4 %/round. Score is rounds survived.',
		},
	];

	let active = $state(modes[0]);

	const riders = [
		{ name: 'Ruben', lives: 3, out: false, points: 11, zone: 4, front: false },
		{ name: 'Sara', lives: 2, out: false, points: 9, zone: 4, front: true },
		{ name: 'You', lives: 3, out: false, points: 7, zone: 5, front: false },
		{ name: 'Nina', lives: 1, out: false, points: 6, zone: 3, front: false },
		{ name: 'Tobi', lives: 0, out: true, points: 3, zone: 2, front: false },
		{ name: 'Milo', lives: 0, out: true, points: 2, zone: 2, front: false },
	];
</script>

<main class="mx-auto max-w-4xl px-6 py-10">
	<h1 class="font-display text-3xl font-bold tracking-tight">Game modes</h1>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		A mode is a rule module over the same workout engine: per-tick evaluation,
		its own UI state, an end condition and a podium. Everything is
		%FTP-relative, so a beginner and a Cat A play the same game at their own
		watts.
	</p>

	<div class="mt-6 flex flex-wrap gap-1">
		{#each modes as mode (mode.id)}
			<button
				onclick={() => (active = mode)}
				class="rounded px-3 py-1.5 text-xs {active.id === mode.id
					? 'bg-surface-raised text-ink'
					: 'text-muted hover:text-ink'}">{mode.name}</button
			>
		{/each}
	</div>

	<p class="text-muted mt-4 max-w-2xl text-xs">{active.rule}</p>

	<div class="border-muted/15 bg-surface-raised mt-4 rounded-lg border p-6">
		{#if active.id === 'backyard' || active.id === 'collective'}
			<!-- Elimination: the state that matters is who is still in, and what the line is now. -->
			<div class="flex items-baseline gap-6">
				<div>
					<div
						class="font-display text-watt glow-text text-4xl leading-none font-bold tabular-nums"
					>
						{active.id === 'backyard' ? '95%' : '83%'}
					</div>
					<p class="text-muted mt-1.5 text-[10px] tracking-wider uppercase">
						{active.id === 'backyard' ? 'this round' : 'room average line'}
					</p>
				</div>
				<div>
					<div
						class="font-display text-2xl leading-none font-bold tabular-nums"
					>
						4
					</div>
					<p class="text-muted mt-1.5 text-[10px] tracking-wider uppercase">
						round
					</p>
				</div>
				<div class="ml-auto text-right">
					<div
						class="font-display text-2xl leading-none font-bold tabular-nums"
					>
						1:12
					</div>
					<p class="text-muted mt-1.5 text-[10px] tracking-wider uppercase">
						left in round
					</p>
				</div>
			</div>
			<ul class="mt-5 space-y-1.5">
				{#each riders as rider (rider.name)}
					<li
						class="flex items-center gap-3 text-sm {rider.out
							? 'opacity-40'
							: ''}"
					>
						<span class="w-16 truncate">{rider.name}</span>
						{#if rider.out}
							<span class="text-danger text-xs"
								>out — round {rider.name === 'Tobi' ? 3 : 2}</span
							>
							<span class="text-muted ml-auto text-[11px]"
								>riding 50 % FTP, still here</span
							>
						{:else}
							<div class="bg-surface h-1.5 flex-1 overflow-hidden rounded-full">
								<div class="bg-z4 h-full rounded-full" style="width: 88%"></div>
							</div>
							<span class="text-muted w-10 text-right font-mono text-[11px]"
								>in</span
							>
						{/if}
					</li>
				{/each}
			</ul>
		{:else if active.id === 'lava'}
			<!-- The corridor from the ride screen, doing double duty as a game rule. -->
			<div class="flex items-baseline gap-4">
				<span class="font-display text-2xl font-bold {ZONE_TEXT[4]}"
					>Z4 {ZONE_NAMES[4]}</span
				>
				<span class="text-muted text-xs">91–105 % FTP</span>
				<span class="text-muted ml-auto font-mono text-xs tabular-nums"
					>changes in 0:47</span
				>
			</div>
			<div class="relative mt-5 h-16 overflow-hidden rounded">
				<div class="bg-surface absolute inset-0"></div>
				<div class="bg-z4/25 absolute inset-y-0 left-[46%] w-[24%]"></div>
				<div
					class="bg-watt glow-stroke absolute top-0 bottom-0 left-[58%] w-1 rounded"
				></div>
			</div>
			<ul class="mt-5 space-y-1.5">
				{#each riders as rider (rider.name)}
					<li
						class="flex items-center gap-3 text-sm {rider.out
							? 'opacity-40'
							: ''}"
					>
						<span class="w-16 truncate">{rider.name}</span>
						<span class="flex gap-1">
							{#each { length: 3 } as _, i (i)}
								<span
									class="h-2.5 w-2.5 rounded-full {i < rider.lives
										? 'bg-danger'
										: 'bg-muted/20'}"
								></span>
							{/each}
						</span>
						<span class="{ZONE_TEXT[rider.zone]} ml-auto text-xs"
							>Z{rider.zone}</span
						>
					</li>
				{/each}
			</ul>
		{:else if active.id === 'golf'}
			<!-- The whole mode is the absence of a meter. -->
			<div class="text-center">
				<p class="text-muted text-[10px] tracking-[0.2em] uppercase">
					hole 4 of 9
				</p>
				<div
					class="font-display mt-2 text-5xl leading-none font-bold tabular-nums"
				>
					228 W
				</div>
				<p class="text-muted mt-2 text-xs">for 10 seconds, starting in 6</p>
				<div
					class="border-muted/20 text-muted mt-6 rounded-lg border border-dashed py-8 text-xs"
				>
					your power is hidden until the hole ends
				</div>
				<p class="text-muted mt-4 font-mono text-xs tabular-nums">
					strokes so far: 14 · best hole 3 W off
				</p>
			</div>
		{:else if active.id === 'roulette'}
			<div class="text-center">
				<p class="text-muted text-[10px] tracking-[0.2em] uppercase">
					next sprint
				</p>
				<div
					class="font-display text-watt glow-text-strong mt-2 text-6xl leading-none font-bold"
				>
					?
				</div>
				<p class="text-muted mt-3 text-xs">
					Somewhere in the next 3–8 minutes. The klaxon gives you 3 seconds.
				</p>
				<div class="mt-6 grid grid-cols-3 gap-3">
					{#each [{ n: 'Ruben', v: '14.3' }, { n: 'Sara', v: '12.6' }, { n: 'You', v: '10.8' }] as best, i (best.n)}
						<div class="bg-surface rounded p-3">
							<p class="text-muted text-[10px] uppercase">best {i + 1}</p>
							<p class="font-display mt-1 font-bold">{best.n}</p>
							<p class="font-mono text-xs tabular-nums">{best.v} w/kg</p>
						</div>
					{/each}
				</div>
			</div>
		{:else if active.id === 'points'}
			<ul class="space-y-2">
				{#each [...riders].sort((a, b) => b.points - a.points) as rider, i (rider.name)}
					<li class="flex items-center gap-3">
						<span class="text-muted w-5 font-mono text-xs tabular-nums"
							>{i + 1}</span
						>
						<span class="w-16 truncate text-sm">{rider.name}</span>
						<div class="bg-surface h-2 flex-1 overflow-hidden rounded-full">
							<div
								class="{ZONE_BG[4]} h-full rounded-full"
								style="width: {(rider.points / 11) * 100}%"
							></div>
						</div>
						<span class="font-display w-8 text-right font-bold tabular-nums"
							>{rider.points}</span
						>
					</li>
				{/each}
			</ul>
			<p class="text-muted mt-4 text-[11px]">
				Sprint 5/3/2/1 · cleanest interval 3 · in-zone streak 1
			</p>
		{:else}
			<!-- Team Relay: one number the whole room owns. -->
			<div class="flex items-baseline gap-6">
				<div>
					<p class="text-muted text-[10px] tracking-[0.2em] uppercase">
						on the front
					</p>
					<p
						class="font-display text-watt glow-text mt-1 text-3xl leading-none font-bold"
					>
						Sara
					</p>
				</div>
				<div class="ml-auto text-right">
					<p class="font-display text-2xl leading-none font-bold tabular-nums">
						0:24
					</p>
					<p class="text-muted mt-1 text-[10px] tracking-wider uppercase">
						until rotation
					</p>
				</div>
			</div>
			<div class="mt-5 grid grid-cols-3 gap-2">
				{#each riders as rider (rider.name)}
					<div
						class="rounded px-3 py-2 text-xs {rider.front
							? 'bg-watt/15 text-ink'
							: 'bg-surface text-muted'}"
					>
						{rider.name}
						<span class="block font-mono text-[10px] tabular-nums"
							>{rider.front ? '110 % FTP' : '55 % FTP'}</span
						>
					</div>
				{/each}
			</div>
			<p class="text-muted mt-5 font-mono text-xs tabular-nums">
				room distance: Σ front-seconds × front-watts · {formatClock(742)} covered
			</p>
		{/if}
	</div>
</main>
