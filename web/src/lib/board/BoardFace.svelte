<script lang="ts">
	/**
	 * The pads themselves — face 1 of the board panel (#981).
	 *
	 * A pad's face is its own waveform, so a sound is found by silhouette at
	 * arm's length rather than read. Idle is violet and flat because chrome
	 * never glows; the part that has already played takes the live hue,
	 * because that is what ADR-0005 reserves it for.
	 */
	import { Plus } from '@lucide/svelte';
	import { board, type Clip } from '$lib/board/clips.svelte';
	import { learn, shapeOf } from '$lib/board/shapes.svelte';

	let {
		mine,
		onPress,
	}: {
		/** The pad this rider has sounding, so only their own press lights up. */
		mine: number | undefined;
		/** `alt` is the audition: only this rider hears it (#981). */
		onPress: (pad: number, alt: boolean) => void;
	} = $props();

	const pads = $derived(
		Array.from({ length: board.padCount }, (_, i) => ({
			slot: i + 1,
			clip: board.onPad(i + 1),
		})),
	);

	// The real envelope once the audio has been decoded for playback, the
	// id-derived shape until then — the pad never waits to draw.
	function bars(clip: Clip) {
		learn(clip.id, 20);
		return shapeOf(clip.id, 20);
	}
</script>

<div
	class="grid max-h-[min(60vh,32rem)] grid-cols-3 gap-2 overflow-y-auto px-0.5"
>
	{#each pads as { slot, clip } (slot)}
		{@const playing = mine === slot}
		<button
			onclick={(e) => onPress(slot, e.altKey)}
			title={clip
				? `${clip.name} — key ${slot} · alt-click to hear it yourself`
				: `Pad ${slot} is empty — add a clip`}
			class="relative flex h-23 flex-col gap-1 overflow-hidden rounded border p-2 text-left {clip
				? playing
					? 'border-watt/50 bg-watt/8'
					: 'border-muted/20 bg-surface-raised hover:border-muted/40'
				: 'border-muted/20 border-dashed'}"
		>
			{#if clip}
				<span class="flex items-start">
					<span class="flex-1"></span>
					<!-- Only a pad a key actually fires wears one. A badge on
					     pad 10 would draw a shortcut that does nothing, and a
					     control that does something else than it draws is not
					     a control (ux.md). -->
					{#if clip.key}
						<span
							class="font-display rounded-[3px] border px-1.5 py-0.5 text-[10px] leading-none {playing
								? 'border-watt/40 text-watt'
								: 'border-muted/25 text-muted'} uppercase">{clip.key}</span
						>
					{/if}
				</span>
				<span class="flex flex-1 items-center">
					<svg
						viewBox="0 0 104 34"
						width="100%"
						height="34"
						preserveAspectRatio="none"
						aria-hidden="true"
					>
						<g class={playing ? 'text-watt glow-stroke' : 'text-neon/55'}>
							{#each bars(clip) as bar, i (i)}
								<rect
									x={bar.x}
									y={bar.y}
									width="3"
									height={bar.h}
									rx="1.5"
									fill="currentColor"
								/>
							{/each}
						</g>
					</svg>
				</span>
				<span
					class="truncate text-[11px] leading-tight {playing
						? 'font-medium'
						: 'text-ink/85'}">{clip.name}</span
				>
			{:else}
				<span
					class="text-muted/55 absolute inset-0 flex flex-col items-center justify-center gap-1"
				>
					<Plus size={16} />
					<span class="text-[10px]">empty</span>
				</span>
			{/if}
		</button>
	{/each}
</div>
