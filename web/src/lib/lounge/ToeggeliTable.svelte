<script lang="ts">
	// Töggeli on the arcade cabinet: challenge someone in the voice channel,
	// play them live, or watch (docs/spec/lounge.md). The hub runs the match.
	import { untrack } from 'svelte';
	import type {
		ToeggeliCommand,
		ToeggeliInvite,
		ToeggeliState,
	} from '$lib/protocol';
	import { play } from '$lib/sound/cues';
	import { SCREEN_H as H, SCREEN_W as W } from '$lib/lounge/games/game';
	import { drawTable, rodAt } from '$lib/lounge/games/toeggeli';

	let {
		table,
		invites,
		riders,
		you,
		send,
	}: {
		table: ToeggeliState | null;
		invites: ToeggeliInvite[];
		/** Everyone else in the voice channel. */
		riders: { id: string; name: string }[];
		you?: string;
		send: (cmd: ToeggeliCommand) => void;
	} = $props();

	const side = $derived(
		table && you
			? table.left === you
				? 'left'
				: table.right === you
					? 'right'
					: undefined
			: undefined,
	);
	const playing = $derived(!!side && table?.phase !== 'over');
	const asked = $derived(
		new Set(invites.filter((i) => i.from === you).map((i) => i.to)),
	);
	const askedMe = $derived(invites.filter((i) => i.to === you));

	// Where this rider's rods are and whether they kick, sent as they change.
	let rodY = 0.5;
	let kick = false;
	let keys = { up: false, down: false };
	let sent = { y: -1, kick: false, at: 0 };

	function canvasLoop(canvas: HTMLCanvasElement) {
		const g = canvas.getContext('2d')!;
		let last = performance.now();
		let frame = requestAnimationFrame(function tick(now) {
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			if (playing) {
				const dir = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
				if (dir) rodY = Math.min(1, Math.max(0, rodY + dir * 1.4 * dt));
				const moved = Math.abs(rodY - sent.y) > 0.004 || kick !== sent.kick;
				if (moved && now - sent.at > 1000 / 30) {
					send({ op: 'move', y: rodY, kick });
					sent = { y: rodY, kick, at: now };
				}
			}
			drawTable(g, table);
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	}

	function pointer(e: PointerEvent) {
		if (!playing) return;
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		rodY = rodAt(((e.clientY - box.top) / box.height) * H);
	}

	function key(e: KeyboardEvent, down: boolean) {
		if (!playing) return;
		if (e.code === 'Space') {
			e.preventDefault();
			kick = down;
		} else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
			e.preventDefault();
			keys.up = down;
		} else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
			e.preventDefault();
			keys.down = down;
		}
	}

	// A goal and a result each get a sound, for players and watchers alike.
	let heard = { goals: 0, phase: '' };
	$effect(() => {
		const goals = (table?.leftGoals ?? 0) + (table?.rightGoals ?? 0);
		const phase = table?.phase ?? '';
		untrack(() => {
			if (goals > heard.goals) play('horn');
			if (phase === 'over' && heard.phase !== 'over')
				play(table?.winner === you ? 'fanfare' : 'summit');
			heard = { goals, phase };
		});
	});
</script>

<svelte:window onkeydown={(e) => key(e, true)} onkeyup={(e) => key(e, false)} />

<p class="text-muted mt-1 text-sm">
	{#if side && table}
		You play the {side === 'left' ? 'teal' : 'red'} side, attacking to the {side ===
		'left'
			? 'right'
			: 'left'}. Move with the mouse or the arrow keys, hold Space or the table
		to kick. First to five, or the most goals after three minutes.
	{:else if table}
		Watching {table.leftName} against {table.rightName}. Challenge the winner
		when the table is free.
	{:else}
		Table football against someone in the voice channel. First to five, or the
		most goals after three minutes.
	{/if}
</p>
<div
	role="application"
	aria-label={playing
		? 'The table: move to set your rods, press to kick'
		: 'The table'}
	class="mt-3 block w-full touch-none select-none"
	onpointermove={pointer}
	onpointerdown={(e) => {
		pointer(e);
		kick = true;
	}}
	onpointerup={() => (kick = false)}
	onpointerleave={() => (kick = false)}
	onpointercancel={() => (kick = false)}
>
	<canvas
		width={W}
		height={H}
		{@attach canvasLoop}
		class="w-full rounded [image-rendering:pixelated]"
	></canvas>
</div>
<div class="mt-3 flex min-h-9 flex-wrap items-center gap-2">
	{#if playing}
		<button
			type="button"
			class="btn btn-ghost"
			onclick={() => send({ op: 'leave' })}>Walk away</button
		>
	{:else if !table}
		{#each askedMe as invite (invite.from)}
			<p class="text-sm">
				<span class="font-semibold">{invite.fromName}</span> challenges you.
			</p>
			<button
				type="button"
				class="btn btn-primary"
				onclick={() => send({ op: 'accept', to: invite.from })}>Play</button
			>
			<button
				type="button"
				class="btn btn-ghost"
				onclick={() => send({ op: 'decline', to: invite.from })}>Not now</button
			>
		{/each}
		{#if !askedMe.length}
			{#each riders as rider (rider.id)}
				{#if asked.has(rider.id)}
					<span class="text-muted text-sm">Waiting for {rider.name}…</span>
					<button
						type="button"
						class="btn btn-ghost btn-xs"
						onclick={() => send({ op: 'decline', to: rider.id })}
						>Take it back</button
					>
				{:else}
					<button
						type="button"
						class="btn btn-secondary"
						onclick={() => send({ op: 'challenge', to: rider.id })}
						>Challenge {rider.name}</button
					>
				{/if}
			{:else}
				<p class="text-muted text-sm">
					Töggeli takes two. When someone else is in the voice channel,
					challenge them here.
				</p>
			{/each}
		{/if}
	{/if}
</div>
