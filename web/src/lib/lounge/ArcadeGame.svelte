<script lang="ts">
	// The room's arcade cabinet (docs/spec/lounge.md): three games on one
	// button, today's course the same for every crew, and the crew's boards.
	import Crown from '@lucide/svelte/icons/crown';
	import Mountain from '@lucide/svelte/icons/mountain';
	import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
	import Target from '@lucide/svelte/icons/target';
	import Trophy from '@lucide/svelte/icons/trophy';
	import Modal from '$lib/components/Modal.svelte';
	import { api } from '$lib/api';
	import { play } from '$lib/sound/cues';
	import type { CueId } from '$lib/sound/cue-catalogue';
	import { GAMES, gameOf } from '$lib/lounge/games';
	import {
		SCREEN_H as H,
		SCREEN_W as W,
		type GameId,
		type Sound,
	} from '$lib/lounge/games/game';
	import type { ArcadeEntry, ArcadeView } from '$lib/lounge/memory';
	import { loadPref, savePref } from '$lib/lounge/arcade-pick';

	let {
		crew,
		onclose,
		onscore,
		you,
	}: {
		crew: string;
		onclose: () => void;
		onscore: () => void;
		/** Your rider id: your rows stand out. */
		you?: string;
	} = $props();

	const ICONS = { bergpreis: Mountain, feedzone: ShoppingBag, darts: Target };
	/** What each of a game's sounds plays on the cue bus. */
	const CUE: Record<Sound, CueId> = {
		grab: 'handup',
		miss: 'shutter',
		throw: 'whoosh',
		hit: 'equip',
		bull: 'cowbell',
	};

	let view = $state<ArcadeView | undefined>();
	let failed = $state(false);
	let picked = $state<GameId>(loadPref());
	const game = $derived(gameOf(picked));
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let run = $state.raw<any>(gameOf(loadPref()).start(0));
	let phase = $state<'ready' | 'playing' | 'done'>('ready');
	/** The best you had before this run, and whether the run beat it. */
	let bestBefore = 0;
	let beat = $state(false);
	let held = false;
	let board = $state<'today' | 'top' | 'cup'>('today');

	async function load() {
		const res = await api<ArcadeView>(`/api/crews/${crew}/arcade`);
		if (res.ok) view = res.data;
		else failed = true;
	}
	void load();

	const seed = $derived(view?.seed ?? 0);
	const mine = $derived(view?.games[picked]);
	const courseDay = $derived(
		view
			? new Date(`${view.day}T12:00:00Z`).toLocaleDateString('en-GB', {
					weekday: 'short',
					day: 'numeric',
					month: 'short',
				})
			: '',
	);

	function pick(id: GameId) {
		if (phase === 'playing') return;
		picked = id;
		savePref(id);
		run = gameOf(id).start(seed);
		phase = 'ready';
		beat = false;
	}

	function canvasLoop(canvas: HTMLCanvasElement) {
		const g = canvas.getContext('2d')!;
		let last = performance.now();
		let frame = requestAnimationFrame(function tick(now) {
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			const playing = gameOf(picked);
			if (phase === 'playing') {
				const before = run;
				run = playing.step(run, dt, held);
				const sound = playing.sound(before, run);
				if (sound) play(CUE[sound]);
				if (playing.over(run)) void finish();
			}
			playing.draw(g, run);
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	}

	async function finish() {
		phase = 'done';
		held = false;
		const score = game.score(run);
		beat = score > bestBefore && score > 0;
		play(beat ? 'fanfare' : 'summit');
		await api(`/api/crews/${crew}/arcade`, {
			method: 'POST',
			json: { game: picked, score },
		});
		await load();
		onscore();
	}

	function begin() {
		bestBefore = mine?.best ?? 0;
		beat = false;
		run = game.start(seed);
		phase = 'playing';
		play('go');
	}

	function key(e: KeyboardEvent, down: boolean) {
		if (e.code !== 'Space') return;
		e.preventDefault();
		if (phase === 'playing') held = down;
		else if (down && !e.repeat && (view || failed)) begin();
	}

	const rows = $derived<
		{ id: string; name: string; value: number; crown?: boolean }[]
	>(
		board === 'cup'
			? (view?.cup ?? [])
					.slice(0, 5)
					.map((e) => ({ id: e.id, name: e.name, value: e.wins }))
			: (mine?.[board] ?? []).map((e: ArcadeEntry, i: number) => ({
					id: e.id,
					name: e.name,
					value: e.score,
					crown: board === 'top' && i === 0,
				})),
	);
	const EMPTY = {
		today: 'Nobody has played today’s course yet.',
		top: 'Nobody yet. The record is yours to set.',
		cup: 'Nobody has won a day this week yet. The cup starts again on Monday.',
	};
</script>

<svelte:window onkeydown={(e) => key(e, true)} onkeyup={(e) => key(e, false)} />

<Modal label="The arcade" {onclose} class="max-w-xl">
	<div class="flex flex-wrap gap-2" role="tablist" aria-label="Games">
		{#each GAMES as g (g.id)}
			{@const Icon = ICONS[g.id as GameId]}
			<button
				type="button"
				role="tab"
				aria-selected={picked === g.id}
				disabled={phase === 'playing'}
				onclick={() => pick(g.id)}
				class="btn {picked === g.id ? 'btn-primary' : 'btn-ghost'}"
				><Icon size={16} /> {g.name}</button
			>
		{/each}
	</div>
	<p class="eyebrow mt-3">
		{courseDay ? `Today’s course · ${courseDay}` : 'Today’s course'}
	</p>
	<p class="text-muted mt-1 text-sm">{game.how}</p>
	<button
		type="button"
		aria-label={game.button}
		class="mt-3 block w-full touch-none select-none"
		onpointerdown={() =>
			phase === 'playing' ? (held = true) : (view || failed) && begin()}
		onpointerup={() => (held = false)}
		onpointerleave={() => (held = false)}
		onpointercancel={() => (held = false)}
	>
		<canvas
			width={W}
			height={H}
			{@attach canvasLoop}
			class="w-full rounded [image-rendering:pixelated]"
		></canvas>
	</button>
	<div class="mt-3 flex min-h-9 flex-wrap items-center gap-3">
		{#if phase !== 'playing'}
			<button
				type="button"
				onclick={begin}
				disabled={!view && !failed}
				class="btn btn-primary"
				>{phase === 'done' ? 'Play again' : 'Start'}</button
			>
		{/if}
		{#if phase === 'done'}
			<p class="font-display text-lg font-bold tabular-nums">
				{game.score(run)} points
			</p>
			{#if beat}<p
					class="font-display bg-neon/20 text-ink rounded px-2 py-0.5 text-sm font-bold"
					role="status"
				>
					<Trophy size={14} class="inline" /> New best
				</p>{/if}
		{:else if phase === 'ready' && mine?.best}
			<p class="text-muted text-sm">
				Your best: <span class="font-display tabular-nums">{mine.best}</span>
			</p>
		{/if}
	</div>
	<div class="mt-4 flex gap-1" role="tablist" aria-label="Boards">
		{#each [['today', 'Today'], ['top', 'All time'], ['cup', 'This week’s cup']] as const as [id, label] (id)}
			<button
				type="button"
				role="tab"
				aria-selected={board === id}
				onclick={() => (board = id)}
				class="btn btn-xs {board === id ? 'btn-secondary' : 'btn-ghost'}"
				>{label}</button
			>
		{/each}
	</div>
	{#if failed}
		<p class="text-muted mt-2 text-sm">
			The boards could not be loaded. Close the arcade and open it again.
		</p>
	{:else if rows.length}
		<ol class="mt-2 grid gap-1 text-sm">
			{#each rows as entry, i (entry.id)}
				<li
					class="flex items-center justify-between gap-3 rounded px-1 {entry.id ===
					you
						? 'bg-neon/10'
						: ''}"
				>
					<span class="flex min-w-0 items-center gap-1.5 truncate"
						>{i + 1}. {entry.name}{#if entry.crown}<Crown
								size={14}
								class="text-warn shrink-0"
								aria-label="record holder"
							/>{/if}</span
					>
					<span class="font-display tabular-nums"
						>{entry.value}{board === 'cup'
							? entry.value === 1
								? ' win'
								: ' wins'
							: ''}</span
					>
				</li>
			{/each}
		</ol>
	{:else}
		<p class="text-muted mt-2 text-sm">{EMPTY[board]}</p>
	{/if}
</Modal>
