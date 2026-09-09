<script lang="ts">
	/**
	 * The seven game modes, drawn by the real GamePanel over mock state
	 * (#1593): the hand copy that stood here glowed percentages and names
	 * (ADR-0005) and showed states the product lacks. Every parameter comes
	 * from docs/SPEC.md's game-mode table; the server owns every rule.
	 */
	import GamePanel from '$lib/room/GamePanel.svelte';
	import { GAME_MODES } from '$lib/room/modes';
	import type { GameState, SprintScore } from '$lib/protocol';

	const roster = [
		{ id: 'ruben', name: 'Ruben' },
		{ id: 'sara', name: 'Sara' },
		{ id: 'demo', name: 'You' },
		{ id: 'nina', name: 'Nina' },
		{ id: 'tobi', name: 'Tobi' },
		{ id: 'milo', name: 'Milo' },
	];
	const now = Date.now();

	type Rider = GameState['riders'][string];
	const riders = (
		over: Record<string, Partial<Rider>>,
	): Record<string, Rider> =>
		Object.fromEntries(roster.map((r) => [r.id, { ...(over[r.id] ?? {}) }]));
	const podium = (
		order: string[],
		value: (i: number) => number,
	): SprintScore[] =>
		order.map((id, i) => ({
			riderId: id,
			name: roster.find((r) => r.id === id)?.name ?? id,
			wkg: value(i),
			watts: 0,
		}));

	/** A mid-game and a finished state per mode — the two the panel draws. */
	function states(mode: string): { running: GameState; done: GameState } {
		switch (mode) {
			case 'backyard-ramp':
			case 'collective-ramp': {
				const line = mode === 'backyard-ramp' ? 0.9 : 0.83;
				const out = { tobi: { eliminated: true }, milo: { eliminated: true } };
				return {
					running: {
						mode,
						phase: 'running',
						round: 3,
						linePct: line,
						roundEndsAtMs: now + 95_000,
						riders: riders(out),
					},
					done: {
						mode,
						phase: 'done',
						round: 5,
						linePct: line,
						riders: riders(out),
						podium: podium(
							['ruben', 'sara', 'demo', 'nina', 'tobi', 'milo'],
							(i) => 6 - i,
						).map((s, i) => ({
							...s,
							rounds: [5, 5, 4, 3, 2, 1][i],
						})),
					},
				};
			}
			case 'floor-is-lava':
				return {
					running: {
						mode,
						phase: 'running',
						calledZone: 4,
						roundEndsAtMs: now + 70_000,
						riders: riders({
							ruben: { lives: 3 },
							sara: { lives: 2 },
							demo: { lives: 3 },
							nina: { lives: 1 },
							tobi: { lives: 0, eliminated: true },
							milo: { lives: 0, eliminated: true },
						}),
					},
					done: {
						mode,
						phase: 'done',
						calledZone: 5,
						riders: riders({
							ruben: { lives: 3 },
							demo: { lives: 2 },
							sara: { lives: 1 },
						}),
						podium: podium(
							['ruben', 'demo', 'sara', 'nina', 'tobi', 'milo'],
							(i) => 6 - i,
						),
					},
				};
			case 'watt-golf':
				return {
					running: {
						mode,
						phase: 'running',
						round: 4,
						linePct: 0.88,
						meterHidden: true,
						roundEndsAtMs: now + 6_000,
						riders: riders({
							ruben: { score: 41 },
							sara: { score: 48 },
							demo: { score: 52 },
						}),
					},
					done: {
						mode,
						phase: 'done',
						round: 9,
						riders: riders({}),
						podium: podium(['ruben', 'sara', 'demo'], (i) => [88, 97, 112][i]),
					},
				};
			case 'sprint-roulette':
				return {
					running: {
						mode,
						phase: 'running',
						round: 2,
						roundStartsAtMs: now + 3_000,
						roundEndsAtMs: now + 15_000,
						riders: riders({
							ruben: { score: 14.3 },
							sara: { score: 12.6 },
							demo: { score: 10.8 },
						}),
					},
					done: {
						mode,
						phase: 'done',
						round: 4,
						riders: riders({}),
						podium: podium(
							['ruben', 'sara', 'demo'],
							(i) => [14.3, 12.6, 10.8][i],
						),
					},
				};
			case 'points-race':
				return {
					running: {
						mode,
						phase: 'running',
						round: 3,
						roundEndsAtMs: now + 40_000,
						riders: riders({
							ruben: { score: 11 },
							sara: { score: 9 },
							demo: { score: 7 },
							nina: { score: 6 },
							tobi: { score: 3 },
							milo: { score: 2 },
						}),
					},
					done: {
						mode,
						phase: 'done',
						round: 6,
						riders: riders({}),
						podium: podium(
							['ruben', 'sara', 'demo', 'nina', 'tobi', 'milo'],
							(i) => [11, 9, 7, 6, 3, 2][i],
						),
					},
				};
			default:
				return {
					running: {
						mode: 'team-relay',
						phase: 'running',
						roundEndsAtMs: now + 50_000,
						roomDistance: 12.4,
						riders: riders({
							sara: { onFront: true, targetPct: 1.1 },
							ruben: { targetPct: 0.55 },
							demo: { targetPct: 0.55 },
							nina: { targetPct: 0.55 },
						}),
					},
					done: {
						mode: 'team-relay',
						phase: 'done',
						roomDistance: 31.2,
						riders: riders({}),
						podium: podium(['sara', 'ruben', 'demo', 'nina'], (i) => 4 - i),
					},
				};
		}
	}

	let active = $state(GAME_MODES[0].id);
	const shown = $derived(states(active));
	const rule = $derived(GAME_MODES.find((m) => m.id === active));
</script>

<main class="mx-auto max-w-4xl px-6 py-10">
	<h1 class="font-display text-3xl font-bold tracking-tight">Game modes</h1>
	<p class="text-muted mt-2 max-w-2xl text-sm">
		A mode is a rule module over the same workout engine: per-tick evaluation,
		its own UI state, an end condition and a podium. Everything is
		%FTP-relative, so a beginner and a Cat A play the same game at their own
		watts. Below: the real panel, over mock state, mid-game and done.
	</p>

	<div class="mt-6 flex flex-wrap gap-1">
		{#each GAME_MODES as mode (mode.id)}
			<button
				onclick={() => (active = mode.id)}
				class="rounded px-3 py-1.5 text-xs {active === mode.id
					? 'bg-surface-raised text-ink'
					: 'text-muted hover:text-ink'}">{mode.label}</button
			>
		{/each}
	</div>
	{#if rule}
		<p class="text-muted mt-3 text-xs">{rule.blurb}</p>
	{/if}

	<div class="mt-6 grid gap-6 md:grid-cols-2">
		<section class="panel p-4">
			<p class="eyebrow mb-3">mid-game</p>
			<GamePanel
				game={shown.running}
				{roster}
				end={() => {}}
				canControl
				me="demo"
			/>
		</section>
		<section class="panel p-4">
			<p class="eyebrow mb-3">done</p>
			<GamePanel
				game={shown.done}
				{roster}
				end={() => {}}
				canControl={false}
				me="demo"
			/>
		</section>
	</div>
</main>
