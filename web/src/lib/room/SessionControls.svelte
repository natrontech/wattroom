<script lang="ts">
	// The coach's mid-ride controls (roles matrix): sprint, pause, resume,
	// end. RoomLive carried them in its header; the split into places lost
	// them, which left a coach with no way to end a session. They render in
	// the Lounge's action row and the Training header — the two places a
	// coach stands during a session — from one definition.
	//
	// Thumb-sized (ux.md): the one control you reach for at 160 bpm cannot be
	// a 12 px label — which is exactly why End asks first. A stray thumb on a
	// 44 px target ends the ride for the whole room, and there is no undo to
	// offer (errors.md's confirm exception), so it confirms the way the solo
	// ride does. Cancelling a countdown loses nothing and does not ask.
	import { useRoom } from '$lib/room/context';
	import { Pause, Play, Radio, Square, Zap } from '@lucide/svelte';

	let { compact = false }: { compact?: boolean } = $props();

	const room = useRoom();
	const phase = $derived(room.shared?.phase);
	const running = $derived(phase === 'running');
	const paused = $derived(phase === 'paused');
	const idle = $derived(!phase || phase === 'idle' || phase === 'done');

	function endSession() {
		const n = room.riders.length;
		if (
			confirm(
				`End the session for ${n} rider${n === 1 ? '' : 's'}? The ride stops for everyone and cannot be resumed.`,
			)
		) {
			room.control('end');
		}
	}
</script>

{#if room.canControl}
	{#if idle}
		<button
			onclick={() => room.openPicker()}
			class="btn btn-accent {compact ? '' : 'btn-lg'}"
			><Radio size={15} /> Start a session</button
		>
	{:else if phase === 'countdown'}
		<button onclick={() => room.control('end')} class="btn btn-danger"
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
					title="Sprint"
					aria-label="arm a sprint"
					class="text-watt hover:bg-watt/10 flex items-center justify-center gap-1.5 rounded text-sm disabled:opacity-40 {compact
						? 'h-11 w-11'
						: 'px-3 py-2'}"
					><Zap size={compact ? 18 : 14} />{#if !compact}Sprint{/if}</button
				>
				<button
					onclick={() => room.control('pause')}
					title="Pause"
					aria-label="pause the session"
					class="text-muted hover:text-ink flex items-center justify-center gap-1.5 rounded text-sm {compact
						? 'h-11 w-11'
						: 'px-3 py-2'}"
					><Pause size={compact ? 18 : 14} />{#if !compact}Pause{/if}</button
				>
			{:else if paused}
				<button
					onclick={() => room.control('resume')}
					title="Resume"
					aria-label="resume the session"
					class="hover:bg-surface-raised flex items-center justify-center gap-1.5 rounded text-sm {compact
						? 'h-11 w-11'
						: 'px-3 py-2'}"
					><Play size={compact ? 18 : 14} />{#if !compact}Resume{/if}</button
				>
			{/if}
			<button
				onclick={endSession}
				title="End"
				aria-label="end the session"
				class="text-z6 hover:bg-z6/10 flex items-center justify-center gap-1.5 rounded text-sm {compact
					? 'h-11 w-11'
					: 'px-3 py-2'}"
				><Square size={compact ? 16 : 13} />{#if !compact}End{/if}</button
			>
		</div>
	{/if}
{/if}
