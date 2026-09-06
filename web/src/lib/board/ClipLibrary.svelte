<script lang="ts">
	/**
	 * Your clips (#877): drop an MP3 in, put it on a pad, take it off again.
	 * A board is one rider's, so this is only ever your own library — nobody
	 * can add to it and nobody else can see it.
	 */
	import { Trash2, Upload } from '@lucide/svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { contextMenu } from '$lib/context-menu.svelte';
	import {
		assign,
		board,
		PADS,
		remove,
		upload,
		type Clip,
	} from '$lib/board/clips.svelte';
	import { waveform } from '$lib/board/waveform';

	let { onclose }: { onclose: () => void } = $props();

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

	const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
	const megabytes = (bytes: number) => `${(bytes / (1 << 20)).toFixed(1)} MB`;

	function padOptions(clip: Clip) {
		return Array.from({ length: PADS }, (_, i) => i + 1).map((pad) => ({
			pad,
			taken: board.onPad(pad),
			mine: clip.pad === pad,
		}));
	}
</script>

<Modal label="your soundboard clips" {onclose} class="max-w-lg">
	<div class="flex items-baseline gap-3">
		<h2 class="font-display text-lg font-semibold">Your clips</h2>
		<span class="flex-1"></span>
		<span class="text-muted font-display text-[11px] tabular-nums">
			{megabytes(board.used)} of {megabytes(board.limit)}
		</span>
	</div>

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
		class="mt-3 flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-6 text-center {dragging
			? 'border-neon/60'
			: 'border-muted/30'}"
	>
		<p class="text-sm">Drop an MP3 here</p>
		<p class="text-muted text-[11px]">
			It becomes a pad you can hit without looking — up to 60 seconds.
		</p>
		<button
			onclick={() => input?.click()}
			disabled={busy}
			class="btn btn-secondary btn-xs mt-2"
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
		<p
			class="border-danger/40 text-danger mt-3 rounded border px-3 py-2 text-xs"
		>
			{refusal}
		</p>
	{/if}

	{#if board.clips.length > 0}
		<ul class="mt-4 space-y-1">
			{#each board.clips as clip (clip.id)}
				<li
					class="flex min-h-11 items-center gap-3 rounded px-2 py-1"
					{@attach contextMenu(() => [
						...(clip.pad
							? [
									{
										label: 'Take off the board',
										onSelect: () => void assign(clip.id, null),
									},
								]
							: []),
						{
							label: 'Delete clip',
							danger: true,
							onSelect: () => void remove(clip.id),
						},
					])}
				>
					<svg
						viewBox="0 0 104 34"
						width="72"
						height="24"
						preserveAspectRatio="none"
						class="text-neon/55 shrink-0"
						aria-hidden="true"
					>
						{#each waveform(clip.id, 20) as bar, i (i)}
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
					<span class="font-display min-w-0 flex-1 truncate text-sm"
						>{clip.name}</span
					>
					<span
						class="text-muted font-display shrink-0 text-[11px] tabular-nums"
						>{seconds(clip.millis)}</span
					>
					<label class="shrink-0">
						<span class="sr-only">pad for {clip.name}</span>
						<select
							value={clip.pad ?? ''}
							onchange={(e) =>
								void assign(
									clip.id,
									e.currentTarget.value ? Number(e.currentTarget.value) : null,
								)}
							class="input input-xs font-display"
						>
							<option value="">no pad</option>
							{#each padOptions(clip) as option (option.pad)}
								<option value={option.pad}>
									{option.pad}{option.taken && !option.mine
										? ' · replaces'
										: ''}
								</option>
							{/each}
						</select>
					</label>
					<button
						onclick={() => void remove(clip.id)}
						class="icon-btn icon-btn-lg text-muted hover:text-danger"
						aria-label="delete {clip.name}"><Trash2 size={14} /></button
					>
				</li>
			{/each}
		</ul>
	{:else if board.loaded}
		<p class="text-muted mt-4 text-xs">
			No clips yet. The first one you drop lands on pad 1.
		</p>
	{/if}
</Modal>
