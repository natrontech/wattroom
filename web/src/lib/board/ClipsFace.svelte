<script lang="ts">
	/**
	 * Your clips — face 2 of the board panel (#877, re-housed in #981).
	 *
	 * A board is one rider's, so this is only ever your own library: nobody can
	 * add to it and nobody else can see it. It used to be a `<Modal>` opened
	 * from the board, which made the board dim itself out of the way of its own
	 * child; it is a face of the same panel now, and `modals.open` never counts
	 * it.
	 */
	import { Pause, Play, Trash2, Upload } from '@lucide/svelte';
	import { contextMenu } from '$lib/context-menu.svelte';
	import {
		assign,
		board,
		movePad,
		keptMillis,
		MIN_PADS,
		remove,
		upload,
		type Clip,
	} from '$lib/board/clips.svelte';
	import { boardPanel } from '$lib/board/panel.svelte';
	import KeyBinder from '$lib/board/KeyBinder.svelte';
	import ToggleBinder from '$lib/board/ToggleBinder.svelte';
	import { learn, shapeOf } from '$lib/board/shapes.svelte';
	import { preview, previewing, stopPreview } from '$lib/sound/board.svelte';

	let { me }: { me: string } = $props();

	let busy = $state(false);
	let refusal = $state<string | undefined>();
	let dragging = $state(false);
	let input: HTMLInputElement | undefined = $state();

	async function take(files: FileList | null | undefined) {
		if (!files || files.length === 0) return;
		busy = true;
		refusal = undefined;
		for (const file of files) {
			const failed = await upload(file);
			if (failed) {
				refusal = failed.message;
				break;
			}
		}
		busy = false;
	}

	/** Hear it yourself. Nothing leaves the machine — see `preview`. */
	function audition(clip: Clip) {
		if (previewing() === clip.id) stopPreview();
		else void preview(clip.id, me, clip);
	}

	function rowShape(clipId: string) {
		learn(clipId, 20);
		return shapeOf(clipId, 20);
	}

	const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

	function padOptions(clip: Clip) {
		// Every pad in use, plus a spare — the same shape the board draws.
		const slots = Math.max(MIN_PADS, board.padCount);
		return Array.from({ length: slots }, (_, i) => i + 1).map((pad) => ({
			pad,
			taken: board.onPad(pad),
			mine: clip.pad === pad,
		}));
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={(e) => {
		e.preventDefault();
		dragging = false;
		void take(e.dataTransfer?.files);
	}}
	class="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-4 text-center {dragging
		? 'border-neon/60'
		: 'border-muted/30'}"
>
	<p class="text-sm">Drop an MP3 here</p>
	<p class="text-muted text-[11px]">up to 60 seconds · becomes a pad</p>
	<button
		onclick={() => input?.click()}
		disabled={busy}
		class="btn btn-secondary btn-xs mt-1.5"
	>
		<Upload size={13} />
		{busy ? 'Adding…' : 'Choose a file'}
	</button>
	<input
		bind:this={input}
		type="file"
		accept="audio/mpeg,.mp3"
		multiple
		onchange={(e) => {
			void take(e.currentTarget.files);
			e.currentTarget.value = '';
		}}
		class="hidden"
	/>
</div>

{#if refusal}
	<!-- The server owns the rules, so it owns the wording (errors.md). -->
	<p class="border-danger/40 text-danger mt-3 rounded border px-3 py-2 text-xs">
		{refusal}
	</p>
{/if}

{#if board.clips.length > 0}
	<ul class="mt-3 max-h-[min(45vh,24rem)] space-y-1 overflow-y-auto">
		{#each board.clips as clip (clip.id)}
			{@const sounding = previewing() === clip.id}
			<li
				class="flex min-h-11 items-center gap-2 rounded px-1 py-1"
				{@attach contextMenu(() => [
					{
						label: sounding ? 'Stop the preview' : 'Preview',
						hint: 'only you',
						onSelect: () => audition(clip),
					},
					{ label: 'Trim clip', onSelect: () => boardPanel.trim(clip.id) },
					...(clip.pad
						? [
								{
									label: 'Take off the board',
									onSelect: () => void assign(clip.id, null),
								},
							]
						: []),
					'separator',
					{
						label: 'Delete clip',
						danger: true,
						onSelect: () => void remove(clip.id),
					},
				])}
			>
				<!-- The primary action on a clip is shaping it, so it stays on the
				     row and never only in the menu (ux.md). -->
				<button
					onclick={() => boardPanel.trim(clip.id)}
					title="Trim {clip.name}"
					class="flex min-w-0 flex-1 items-center gap-2 text-left"
				>
					<svg
						viewBox="0 0 104 34"
						width="52"
						height="20"
						preserveAspectRatio="none"
						class="text-neon/55 shrink-0"
						aria-hidden="true"
					>
						{#each rowShape(clip.id) as bar, i (i)}
							<rect
								x={bar.x}
								y={bar.y}
								width="3"
								height={bar.h}
								rx="1.5"
								fill="currentColor"
							/>
						{/each}
					</svg>
					<span class="font-display min-w-0 flex-1 truncate text-[13px]"
						>{clip.name}</span
					>
				</button>
				<span class="text-muted font-display shrink-0 text-[10px] tabular-nums"
					>{seconds(keptMillis(clip))}</span
				>
				<!-- Hearing a clip used to mean firing it at the room (#981). The
				     one control that glows here is the one that is making a
				     sound right now — it is live data (ADR-0005). -->
				<button
					onclick={() => audition(clip)}
					title={sounding ? 'stop — only you hear this' : 'preview — only you'}
					aria-label={sounding
						? `stop previewing ${clip.name}`
						: `preview ${clip.name}, only you`}
					class="grid h-8 w-7 shrink-0 place-items-center rounded {sounding
						? 'text-watt glow-stroke'
						: 'text-muted hover:text-ink'}"
				>
					{#if sounding}<Pause size={13} />{:else}<Play size={13} />{/if}
				</button>
				<KeyBinder {clip} />
				<label class="shrink-0">
					<span class="sr-only">pad for {clip.name}</span>
					<select
						value={clip.pad ?? ''}
						onchange={(e) =>
							void movePad(
								clip.id,
								e.currentTarget.value ? Number(e.currentTarget.value) : null,
							)}
						class="input input-xs font-display"
					>
						<option value="">no pad</option>
						{#each padOptions(clip) as option (option.pad)}
							<option value={option.pad}>
								{option.pad}{option.taken && !option.mine
									? ` · swaps with ${option.taken.name}`
									: ''}
							</option>
						{/each}
					</select>
				</label>
				<button
					onclick={() => void remove(clip.id)}
					class="icon-btn text-muted hover:text-danger shrink-0"
					aria-label="delete {clip.name}"><Trash2 size={13} /></button
				>
			</li>
		{/each}
	</ul>
{:else if board.loaded}
	<p class="text-muted mt-3 text-xs">
		No clips yet. The first one you drop lands on pad 1.
	</p>
{/if}

<p class="text-muted mt-3 text-[11px]">
	A pad fires on the key next to it, whether the board is showing or not — click
	that key to change it, or press Escape while it is listening to take the key
	away.
</p>

<!-- The chord was named here and nowhere changeable (#982). -->
<ToggleBinder />
