<script lang="ts">
	import ListPlus from '@lucide/svelte/icons/list-plus';
	import Select from '$lib/components/Select.svelte';
	import { queueTracks, type Track } from '$lib/music/pool';
	import type { PlaylistStore } from '$lib/room/playlists.svelte';
	import { toasts } from '$lib/toast.svelte';

	// What the picked rows can do together (#1433). A checkbox per row, this
	// bar while anything is ticked: queueing goes through one request (see
	// queueTracks), saving is one call per track, which the REST side takes
	// without a throttle. Both say what happened in a toast.

	let {
		picked,
		slug = null,
		roomName = '',
		mine,
		roomLists = null,
		onDone,
	}: {
		picked: Track[];
		/** The room the rider is standing in, or null: no room, nothing to queue into. */
		slug?: string | null;
		roomName?: string;
		mine: PlaylistStore;
		roomLists?: PlaylistStore | null;
		/** Called once an action is through — the page drops the ticks. */
		onDone: () => void;
	} = $props();

	let bulkBusy = $state(false);
	let saveTarget = $state('');

	async function queueSelected() {
		if (!slug || !picked.length) return;
		bulkBusy = true;
		const res = await queueTracks(
			slug,
			picked.map((t) => t.id),
		);
		bulkBusy = false;
		if (!res.ok) {
			toasts.push(res.error.message, { tone: 'error' });
			return;
		}
		toasts.push(
			`Queued ${res.data.queued} track${res.data.queued === 1 ? '' : 's'} in ${roomName}.` +
				(res.data.skipped ? ` ${res.data.skipped} could not be queued.` : ''),
		);
		onDone();
	}

	async function saveSelected(targetId: string) {
		const target = [
			...(roomLists?.all ?? []).map((p) => ({ store: roomLists!, p })),
			...mine.all.map((p) => ({ store: mine, p })),
		].find(({ p }) => p.id === targetId);
		if (!target || !picked.length) return;
		bulkBusy = true;
		let saved = 0;
		for (const track of picked) {
			const res = await target.store.addTrack(target.p.id, {
				action: 'add',
				trackId: track.id,
				title: track.title,
				artist: track.artist,
			});
			if (res.ok) saved++;
		}
		bulkBusy = false;
		toasts.push(
			`Saved ${saved} track${saved === 1 ? '' : 's'} to “${target.p.name}”.`,
		);
		onDone();
		saveTarget = '';
	}
</script>

{#if picked.length}
	<div
		class="panel mt-3 flex flex-wrap items-center gap-2 px-4 py-2 text-sm"
		role="region"
		aria-label="picked tracks"
	>
		<span class="font-display tabular-nums">{picked.length} picked</span>
		{#if slug}
			<button
				onclick={() => void queueSelected()}
				disabled={bulkBusy}
				class="btn btn-secondary btn-xs"
				><ListPlus size={13} /> Queue in {roomName}</button
			>
		{/if}
		{#if (roomLists?.all.length ?? 0) + mine.all.length}
			<div class="w-56">
				<Select
					label="save the picked tracks to"
					value={saveTarget}
					options={[
						{ value: '', label: 'Save to…' },
						...(roomLists?.all ?? []).map((p) => ({
							value: p.id,
							label: `${p.name} · ${roomName}`,
						})),
						...mine.all.map((p) => ({ value: p.id, label: p.name })),
					]}
					onchange={(id) => id && void saveSelected(id)}
				/>
			</div>
		{/if}
		<button onclick={onDone} class="btn btn-ghost btn-xs ml-auto">Clear</button>
	</div>
{/if}
