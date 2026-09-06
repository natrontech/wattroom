<script lang="ts">
	// The picker (#878): a grid over the composer, in a room and in a DM
	// alike. It opens on Tenor's featured set so the common case — mid-ride,
	// one hand, three seconds — costs no typing at all (ux.md); the search
	// box is for when you know what you want.
	//
	// Picking posts the GIF's URL as an ordinary message, which MessageText
	// then renders as the GIF (#279). Nothing here knows how chat sends.
	import { RotateCw, Search } from '@lucide/svelte';
	import Banner from '$lib/components/Banner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { focusTrap } from '$lib/components/focus-trap';
	import { searchGifs, type Gif } from './gifs';

	let { onPick, onClose }: { onPick: (gif: Gif) => void; onClose: () => void } =
		$props();

	let query = $state('');
	let results = $state<Gif[]>([]);
	let next = $state<string | undefined>(undefined);
	let loading = $state(true);
	let loadingMore = $state(false);
	let error = $state<string | null>(null);

	// Which search is the current question: a slow "ca" must not land on top
	// of a fast "cat" (the pattern account.svelte.ts uses for /api/me).
	let generation = 0;

	async function run(term: string) {
		const mine = ++generation;
		loading = true;
		error = null;
		const res = await searchGifs(term);
		if (mine !== generation) return;
		loading = false;
		if (res.ok) {
			results = res.data.results;
			next = res.data.next;
		} else {
			error = res.error.message;
		}
	}

	async function more() {
		if (!next || loadingMore) return;
		const mine = generation;
		loadingMore = true;
		const res = await searchGifs(query, next);
		loadingMore = false;
		if (mine !== generation) return;
		if (res.ok) {
			results = [...results, ...res.data.results];
			next = res.data.next;
		} else {
			error = res.error.message;
		}
	}

	// A search per keystroke would spend the rider's ceiling in one word.
	let debounce: ReturnType<typeof setTimeout> | undefined;
	function typed(term: string) {
		query = term;
		clearTimeout(debounce);
		debounce = setTimeout(() => void run(term), 300);
	}

	void run('');

	// Anywhere but here closes it — the composer stays one click away. The
	// button that opened it is the exception: it toggles, and closing on its
	// pointerdown would let its own click reopen what it just shut.
	function outside(node: HTMLElement) {
		const onDown = (event: PointerEvent) => {
			const target = event.target as Element | null;
			if (node.contains(target) || target?.closest?.('[data-gif-toggle]')) {
				return;
			}
			onClose();
		};
		document.addEventListener('pointerdown', onDown, true);
		return () => document.removeEventListener('pointerdown', onDown, true);
	}

	// Tiles are laid out in columns, so the skeleton is too — a grid of equal
	// boxes would jump into a ragged one the moment results land. The columns
	// are sized by WIDTH, not counted: the same picker opens in the room's
	// narrow side panel and on the full-width chat page, and two columns of
	// 420px there made one GIF the whole grid.
	const SKELETON_HEIGHTS = [96, 132, 112, 84, 120, 100];
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onClose()} />

<div
	{@attach outside}
	use:focusTrap
	role="dialog"
	aria-label="Pick a GIF"
	tabindex="-1"
	class="panel absolute right-0 bottom-full left-0 z-20 mb-2 flex max-h-80 flex-col shadow-lg"
>
	<div class="border-ink/5 flex items-center gap-2 border-b px-3 py-2">
		<Search size={14} class="text-muted shrink-0" />
		<input
			value={query}
			oninput={(event) => typed(event.currentTarget.value)}
			maxlength="100"
			placeholder="Search GIFs"
			aria-label="Search GIFs"
			class="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm outline-none"
		/>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto p-2">
		{#if loading}
			<div class="columns-[8rem] gap-2">
				{#each SKELETON_HEIGHTS as height, i (i)}
					<div
						class="skeleton mb-2 rounded"
						style="height: {height}px"
						aria-hidden="true"
					></div>
				{/each}
			</div>
		{:else if error}
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button
						onclick={() => void run(query)}
						class="btn btn-secondary btn-xs"
						><RotateCw size={12} /> Retry</button
					>
				{/snippet}
			</Banner>
		{:else if results.length === 0}
			<EmptyState>
				{query.trim()
					? `Nothing for “${query.trim()}”. A shorter word usually finds more.`
					: 'Tenor has nothing to feature right now — try searching.'}
			</EmptyState>
		{:else}
			<div class="columns-[8rem] gap-2">
				{#each results as gif (gif.id)}
					<button
						onclick={() => onPick(gif)}
						title={gif.alt}
						aria-label="Send {gif.alt || 'this GIF'}"
						class="ring-ink/10 focus-visible:ring-neon hover:ring-neon mb-2 block w-full cursor-pointer break-inside-avoid overflow-hidden rounded ring-1 focus-visible:ring-2"
					>
						<img
							src={gif.preview}
							alt={gif.alt}
							width={gif.width || undefined}
							height={gif.height || undefined}
							loading="lazy"
							class="block h-auto w-full"
						/>
					</button>
				{/each}
			</div>
			{#if next}
				<button
					onclick={() => void more()}
					disabled={loadingMore}
					class="btn btn-secondary btn-xs w-full"
					>{loadingMore ? 'Loading…' : 'More GIFs'}</button
				>
			{/if}
		{/if}
	</div>

	<!-- Tenor's terms ask for the credit, and it says where a bad GIF came
	     from without a settings page to explain it. -->
	<p class="text-muted/70 border-ink/5 border-t px-3 py-1.5 text-[10px]">
		GIFs via Tenor
	</p>
</div>
