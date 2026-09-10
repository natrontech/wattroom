<script lang="ts">
	import ListPlus from '@lucide/svelte/icons/list-plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import {
		contextMenu,
		MENU_HINT,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { trackClock, trackSize, type Track } from '$lib/music/pool';

	// One shelf row (#268, #1433): what a track is, what can be done with it,
	// and — for your own uploads — the tag editor in place, because real-world
	// MP3 tags are garbage and edit beats cleanup (ADR-0015).
	//
	// Every affordance is gated the way ux.md wants it: somebody else's track
	// draws no edit or delete, and with no room open there is nothing to queue
	// into, so no queue button. Nothing here can fail on click.

	let {
		track,
		editing = false,
		picked = false,
		owned = false,
		roomName = null,
		menu,
		onPick,
		onPicked,
		onQueue,
		onEdit,
		onCancel,
		onSave,
		onDelete,
	}: {
		track: Track;
		/** Whether this row is the one being edited. */
		editing?: boolean;
		/** Whether it is ticked for a bulk action. */
		picked?: boolean;
		/** Whether it is the rider's own upload — the only kind they may change. */
		owned?: boolean;
		/** The room the rider is standing in, or null: no room, no queueing. */
		roomName?: string | null;
		/** This row's context menu, built by the page that owns the verbs. */
		menu: () => MenuEntry[];
		/** Stand at one of the shelf's labels. */
		onPick: (tag: string) => void;
		onPicked: (picked: boolean) => void;
		onQueue: () => void;
		onEdit: () => void;
		onCancel: () => void;
		/** The edit form, submitted — the page reads the fields and saves. */
		onSave: (fields: HTMLFormElement) => void;
		onDelete: () => void;
	} = $props();
</script>

<li
	class="panel px-4 py-3"
	title={menu().length ? MENU_HINT : undefined}
	{@attach contextMenu(menu)}
>
	{#if editing}
		<!-- Editable in place: real-world tags are garbage and
				     edit-beats-cleanup (ADR-0015). -->
		<form
			onsubmit={(event) => {
				event.preventDefault();
				onSave(event.currentTarget);
			}}
			class="grid gap-2 sm:grid-cols-4"
		>
			<label class="block">
				<span class="eyebrow">title</span>
				<input
					name="title"
					value={track.title}
					required
					class="input mt-1 w-full"
				/>
			</label>
			<label class="block">
				<span class="eyebrow">artist</span>
				<input
					name="artist"
					value={track.artist ?? ''}
					class="input mt-1 w-full"
				/>
			</label>
			<label class="block">
				<span class="eyebrow">album</span>
				<input
					name="album"
					value={track.album ?? ''}
					class="input mt-1 w-full"
				/>
			</label>
			<label class="block">
				<span class="eyebrow">bpm</span>
				<input
					name="bpm"
					type="number"
					min="1"
					max="399"
					value={track.bpm ?? ''}
					placeholder="–"
					class="input mt-1 w-full font-mono tabular-nums"
				/>
			</label>
			<label class="block sm:col-span-4">
				<span class="eyebrow">tags</span>
				<input
					name="tags"
					value={track.tags.join(', ')}
					placeholder="synthwave, warmup, italo disco"
					class="input mt-1 w-full"
				/>
				<span class="text-muted mt-1 block text-xs">
					Comma-separated, and whatever you like — genre, mood, which part of a
					ride it suits.
				</span>
			</label>
			<div class="flex gap-2 sm:col-span-4">
				<button type="submit" class="btn btn-primary btn-xs">Save</button>
				<button
					type="button"
					onclick={onCancel}
					class="btn btn-secondary btn-xs">Cancel</button
				>
			</div>
		</form>
	{:else}
		<div class="flex items-center gap-4">
			<input
				type="checkbox"
				checked={picked}
				onchange={(event) => onPicked(event.currentTarget.checked)}
				aria-label="Pick {track.title}"
				class="h-5 w-5 shrink-0 accent-[var(--color-neon)]"
			/>
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-medium">{track.title}</p>
				<p class="text-muted truncate text-xs">
					{track.artist || 'Unknown artist'}{track.album
						? ` · ${track.album}`
						: ''}
					{#if track.uploadedBy}· added by {track.uploadedBy}{/if}
				</p>
				{#if track.tags.length}
					<p class="mt-1 flex flex-wrap gap-1">
						{#each track.tags as name (name)}
							<button
								onclick={() => onPick(name)}
								class="border-muted/25 text-muted hover:border-neon/50 rounded-full border px-2 py-1.5 text-[11px]"
								>{name}</button
							>
						{/each}
					</p>
				{/if}
			</div>
			{#if track.bpm}
				<span
					class="border-muted/30 text-muted shrink-0 rounded border px-1.5 text-[10px] tabular-nums"
					title="beats per minute">{track.bpm} bpm</span
				>
			{/if}
			<span class="text-muted shrink-0 font-mono text-xs tabular-nums"
				>{trackClock(track.durationMs)}</span
			>
			<span class="text-muted hidden shrink-0 text-xs sm:inline"
				>{trackSize(track.sizeBytes)}</span
			>
			<!-- Capability gating (ux.md): somebody else's track shows no
					     controls rather than buttons that would 403. -->
			<!-- Capability gating again (ux.md): with no room open there
					     is nowhere to queue, so the button is not drawn — the
					     line under the list says why. -->
			{#if roomName}
				<button
					onclick={onQueue}
					aria-label="Queue {track.title}"
					title="Queue in {roomName}"
					class="btn btn-secondary btn-xs shrink-0"
					><ListPlus size={13} /></button
				>
			{/if}
			{#if owned}
				<button onclick={onEdit} class="btn btn-secondary btn-xs shrink-0"
					>Edit</button
				>
				<button
					onclick={onDelete}
					aria-label="Delete {track.title}"
					class="btn btn-danger btn-xs shrink-0"><Trash2 size={13} /></button
				>
			{/if}
		</div>
	{/if}
</li>
