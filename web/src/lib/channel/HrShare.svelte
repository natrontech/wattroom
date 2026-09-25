<script lang="ts">
	// ADR-0008's affordance, back on the riding surface (#62, #2804): heart
	// rate reaching the call is something a rider sees and stops in one tap,
	// never something they find out about. The case it exists for is a strap
	// bonded to the trainer in another app, which comes through FTMS with no
	// pairing step here at all.
	//
	// Reads the channel's connection directly, as TrainerOverview does: the
	// ride that sends the samples and the profile store it reads the flag
	// from are the connection's, and toggling any other store would change a
	// setting nothing on this screen sends by.
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { hrShareView } from '$lib/channel/hr-share';
	import { play } from '$lib/sound/cues';
	import HeartOff from '@lucide/svelte/icons/heart-off';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';

	let { class: klass = '' }: { class?: string } = $props();

	const conn = $derived(channelConnection.current);
	const view = $derived(
		hrShareView(
			conn?.ride.hrSource ?? null,
			conn?.profile.current.shareHr ?? true,
			conn?.ride.actuating ?? false,
		),
	);
	let error = $state<string | null>(null);

	function toggle() {
		if (!conn || !view) return;
		// Read before the write: the view recomputes from the flag it sets.
		const next = view.next;
		error = conn.profile.update({ shareHr: next });
		// Heard as well as seen (ux.md): the rider is on the bike, and the
		// pitch says which way it went — lower is off, as a pause is.
		if (!error) play('block', next ? 0 : -5);
	}
</script>

{#if view}
	<div
		data-testid="hr-share"
		class="flex flex-wrap items-center gap-x-3 gap-y-1 {klass}"
	>
		<p
			class="flex items-center gap-1.5 text-sm {view.shared
				? 'text-ink'
				: 'text-muted'}"
			role="status"
		>
			{#if view.shared}
				<HeartPulse size={14} aria-hidden="true" />
			{:else}
				<HeartOff size={14} aria-hidden="true" />
			{/if}
			{view.text}
		</p>
		<!-- btn-lg: pressed while pedalling (ux.md's 44 px), and the one
		     control between a rider's health data and everyone in the call.
		     Named in full: a screen share's button says "Stop sharing" too. -->
		<button
			onclick={toggle}
			class="btn btn-secondary btn-lg"
			aria-label="{view.action} heart rate"
			title={view.shared
				? 'Nobody in the call sees your bpm while it is off. A session ride saved meanwhile has none either; a free ride keeps it.'
				: 'Everyone in the call sees your bpm again.'}>{view.action}</button
		>
		{#if error}
			<!-- Where the tap was (errors.md): a storage-blocked browser cannot
			     keep the choice, and the rider has to know it did not stick. -->
			<p class="text-danger text-xs" role="alert">{error}</p>
		{/if}
	</div>
{/if}
