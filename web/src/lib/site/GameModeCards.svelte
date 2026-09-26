<script lang="ts">
	import GameModePreview from './GameModePreview.svelte';
	import { GAME_MODE_LIST } from './game-modes';

	// The seven modes as cards that play (#2995). `full` is /game-modes, with
	// the rules; the landing's strip links there instead.
	// `tryHref` fills the strip's eighth slot with the way to play one now.
	let { full = false, tryHref }: { full?: boolean; tryHref?: string } =
		$props();
</script>

<ul
	class="grid gap-3 sm:grid-cols-2 {full ? 'lg:grid-cols-2' : 'lg:grid-cols-4'}"
>
	{#each GAME_MODE_LIST as mode (mode.slug)}
		<li
			id={full ? mode.slug : undefined}
			class="panel group flex scroll-mt-24 flex-col gap-3 {full
				? 'panel-lg'
				: ''}"
		>
			<div class="bg-surface h-20 overflow-hidden rounded-md px-2 py-1.5">
				<GameModePreview mode={mode.slug} />
			</div>
			<div>
				{#if full}
					<h2 class="font-display text-xl font-bold">{mode.name}</h2>
				{:else}
					<a
						href="/game-modes#{mode.slug}"
						class="font-display font-bold group-hover:underline">{mode.name}</a
					>
				{/if}
				<p class="text-muted mt-1 text-sm">{mode.line}</p>
			</div>
			{#if full}
				<p class="text-sm leading-relaxed">{mode.rules}</p>
				<p class="text-muted text-sm">
					<span class="text-ink">Best for:</span>
					{mode.best}
				</p>
			{/if}
		</li>
	{/each}
	{#if tryHref && !full}
		<li>
			<a
				href={tryHref}
				class="panel border-watt/40 hover:bg-watt/10 flex h-full flex-col justify-center gap-2 text-center"
			>
				<span class="font-display text-lg font-bold">Try one now</span>
				<span class="text-muted text-sm"
					>A Sprint Roulette sprint, right on this page.</span
				>
			</a>
		</li>
	{/if}
</ul>
