<script lang="ts">
	// The coach's mid-ride controls (roles matrix): sprint, pause, resume,
	// end. RoomLive carried them in its header; the split into places lost
	// them, which left a coach with no way to end a session. They render in
	// the Lounge's action row and the Training header — the two places a
	// coach stands during a session — from one definition.
	//
	// Thumb-sized (ux.md): the one control you reach for at 160 bpm cannot be
	// a 12 px label.
	import { useRoom } from '$lib/room/context';
	import { Pause, Play, Radio, Square, Zap } from '@lucide/svelte';

	let { compact = false }: { compact?: boolean } = $props();

	const room = useRoom();
	const phase = $derived(room.shared?.phase);
	const running = $derived(phase === 'running');
	const paused = $derived(phase === 'paused');
	const idle = $derived(!phase || phase === 'idle' || phase === 'done');
	const size = $derived(compact ? 'btn-xs' : '');
</script>

{#if room.canControl}
	{#if idle}
		<button
			onclick={() => room.openPicker()}
			class="btn btn-accent {compact ? '' : 'btn-lg'}"
			><Radio size={15} /> Start a session</button
		>
	{:else if phase === 'countdown'}
		<button onclick={() => room.control('end')} class="btn btn-danger {size}"
			><Square size={13} /> Cancel</button
		>
	{:else}
		<div class="border-muted/20 flex gap-1 rounded border p-0.5">
			{#if running}
				<!-- The sprint is the only control that carries the live hue: it
				     creates live data (ADR-0005's one chrome exception). -->
				<button
					onclick={() => room.control('sprint')}
					disabled={!!room.sprint}
					class="text-watt hover:bg-watt/10 flex items-center gap-1.5 rounded px-3 py-2 text-sm disabled:opacity-40"
					><Zap size={14} /> Sprint</button
				>
				<button
					onclick={() => room.control('pause')}
					class="text-muted hover:text-ink flex items-center gap-1.5 rounded px-3 py-2 text-sm"
					><Pause size={14} /> Pause</button
				>
			{:else if paused}
				<button
					onclick={() => room.control('resume')}
					class="hover:bg-surface-raised flex items-center gap-1.5 rounded px-3 py-2 text-sm"
					><Play size={14} /> Resume</button
				>
			{/if}
			<button
				onclick={() => room.control('end')}
				class="text-z6 hover:bg-z6/10 flex items-center gap-1.5 rounded px-3 py-2 text-sm"
				><Square size={13} /> End</button
			>
		</div>
	{/if}
{/if}
