<script lang="ts">
	// The logbook on the cozy room's desk (docs/spec/lounge.md "Your
	// numbers"): the rider's own level, rider streak, hours ridden and voice
	// time, read from GET /api/me/logbook and seen by nobody else. The
	// arcade's game bests are its next page: `arcade` is where they go.
	import type { Snippet } from 'svelte';
	import Banner from '$lib/components/Banner.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { api } from '$lib/api';
	import { formatDuration } from '$lib/format';
	import { levelFromXp, levelProgress, xpForLevel } from '$lib/level';

	interface Book {
		totalXp: number;
		streakWeeks: number;
		rides: number;
		rideSec: number;
		voiceSec: number;
	}

	let { onclose, arcade }: { onclose: () => void; arcade?: Snippet } = $props();

	let book = $state<Book | null>(null);
	let error = $state('');
	void api<Book>('/api/me/logbook').then((res) => {
		if (res.ok) book = res.data;
		else error = res.error.message;
	});

	const level = $derived(book ? levelFromXp(book.totalXp) : 0);
</script>

<Modal label="Your logbook" {onclose} class="max-w-md">
	<h2 class="font-display text-lg font-bold">Your logbook</h2>
	<p class="text-muted mt-1 text-sm">Only you see what is in it.</p>
	{#if error}
		<div class="mt-4"><Banner tone="error">{error}</Banner></div>
	{:else if !book}
		<Skeleton class="mt-4 h-40" />
	{:else}
		<section class="mt-4" aria-label="Level">
			<p class="font-display text-2xl font-bold tabular-nums">
				Level {level}
			</p>
			<ProgressBar class="mt-2" pct={levelProgress(book.totalXp) * 100} />
			<p class="text-muted mt-1 text-sm tabular-nums">
				{(xpForLevel(level + 1) - book.totalXp).toLocaleString()} XP to level {level +
					1} · {book.totalXp.toLocaleString()} XP so far
			</p>
		</section>
		<dl class="mt-5 grid grid-cols-3 gap-4">
			<div>
				<dt class="eyebrow">Rider streak</dt>
				<dd class="font-display text-xl font-bold tabular-nums">
					{book.streakWeeks}<span class="text-muted ml-1 text-sm"
						>wk{book.streakWeeks === 1 ? '' : 's'}</span
					>
				</dd>
			</div>
			<div>
				<dt class="eyebrow">Ridden</dt>
				<dd class="font-display text-xl font-bold tabular-nums">
					{formatDuration(book.rideSec)}
				</dd>
				<dd class="text-muted text-xs tabular-nums">
					{book.rides.toLocaleString()} ride{book.rides === 1 ? '' : 's'}
				</dd>
			</div>
			<div>
				<dt class="eyebrow">In voice</dt>
				<dd class="font-display text-xl font-bold tabular-nums">
					{formatDuration(book.voiceSec)}
				</dd>
				<dd class="text-muted text-xs">hanging out</dd>
			</div>
		</dl>
		{#if arcade}
			<section class="mt-5" aria-label="Arcade">
				<h3 class="eyebrow mb-1.5">Arcade</h3>
				{@render arcade()}
			</section>
		{/if}
	{/if}
</Modal>
