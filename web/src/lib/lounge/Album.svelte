<script lang="ts">
	// The crew's album: everyone who has come by the room and when, and for
	// the rest a dark shape and a hint.
	import Modal from '#lib/components/Modal.svelte';
	import { VISITOR_NOTES, type Sighting } from '#lib/lounge/album.ts';
	import { VISITORS, type Visitor } from '#lib/lounge/moments.ts';
	import { VISITOR_SPRITES, drawSprite } from '#lib/lounge/draw-visitors.ts';
	import { LOUNGE } from '#lib/lounge/palette.ts';

	let { album, onclose }: { album: Sighting[]; onclose: () => void } = $props();

	const when = (kind: Visitor) =>
		album.find((seen) => seen.kind === kind)?.seenAt;
	const date = (at: string) =>
		new Date(at).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});

	/** The sprite in its colours, or the dark shape of one not seen yet. */
	const sprite = (kind: Visitor) => (canvas: HTMLCanvasElement) => {
		const g = canvas.getContext('2d')!;
		const rows = VISITOR_SPRITES[kind];
		const x = Math.floor((16 - rows[0].length) / 2);
		const y = Math.floor((10 - rows.length) / 2);
		drawSprite(g, kind, x, y, false, when(kind) ? undefined : LOUNGE.cable);
	};
</script>

<Modal label="The room's album" {onclose} class="max-w-2xl">
	<h2 class="font-display text-lg font-bold">The room's album</h2>
	<p class="text-muted mt-1 text-sm">
		{album.length} of {VISITORS.length} have come by. They only come when the room
		is right.
	</p>
	<ul class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
		{#each VISITORS as kind (kind)}
			{@const seen = when(kind)}
			<li class="flex items-center gap-3">
				<canvas
					width="16"
					height="10"
					{@attach sprite(kind)}
					aria-hidden="true"
					class="bg-ink/10 h-[40px] w-[64px] shrink-0 rounded [image-rendering:pixelated]"
				></canvas>
				<div class="min-w-0 text-sm">
					{#if seen}
						<p class="font-medium">{VISITOR_NOTES[kind].name}</p>
						<p class="text-muted text-xs">{date(seen)}</p>
					{:else}
						<p class="text-muted text-xs">{VISITOR_NOTES[kind].hint}</p>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
</Modal>
