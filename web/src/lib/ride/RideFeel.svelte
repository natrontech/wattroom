<script lang="ts">
	/**
	 * How the ride felt (#2328): the one thing on this page the rider writes
	 * rather than the trainer. Optional, erasable, and never asked for twice —
	 * a ride without it is not incomplete.
	 *
	 * ADR-0055: the note is the rider's own and no sharing switch in the
	 * product carries it, which is the only condition under which a rider
	 * writes a true one. The panel says so, once, where the box is.
	 *
	 * One Save for the pair. Undo-over-confirm belongs to actions that happen
	 * on a tap (errors.md); a sentence being typed has a draft, and a rating
	 * tap that posted on its own would race the draft beside it.
	 */
	import Banner from '$lib/components/Banner.svelte';
	import Lock from '@lucide/svelte/icons/lock';
	import { MaxRideNoteChars } from '$lib/protocol';
	import { toasts } from '$lib/toast.svelte';
	import {
		RPE_SCALE,
		noteTooLong,
		rpeLabel,
		setRideFeel,
		type RideFeel,
	} from '$lib/ride/feel';

	let { id, feel }: { id: string; feel: RideFeel } = $props();

	// The draft, seeded from what is stored. Seeded once is enough: the page
	// drops the ride to null while another one loads, so this remounts per
	// ride rather than having to watch the id.
	// svelte-ignore state_referenced_locally
	let rpe = $state<number | null>(feel.rpe);
	// svelte-ignore state_referenced_locally
	let note = $state(feel.note ?? '');
	let saving = $state(false);
	let error = $state<string | null>(null);

	const typed = $derived(note.trim());
	const tooLong = $derived(noteTooLong(note));
	const left = $derived(MaxRideNoteChars - [...typed].length);
	const changed = $derived(
		rpe !== feel.rpe || typed !== (feel.note ?? '').trim(),
	);
	const anything = $derived(rpe !== null || typed !== '');

	async function save() {
		if (!changed || tooLong) return;
		saving = true;
		error = null;
		const res = await setRideFeel(id, {
			rpe,
			note: typed === '' ? null : typed,
		});
		saving = false;
		if (!res.ok) {
			error = res.error.message;
			return;
		}
		// Mutated in place: the parent holds this object on the ride it loaded,
		// and re-fetching the whole ride to learn what we just sent is a read
		// of a sample blob for two fields.
		feel.rpe = res.data.rpe;
		feel.note = res.data.note;
		toasts.push(anything ? 'Saved — only you can see this.' : 'Cleared.');
	}
</script>

<section class="panel panel-xl mt-3">
	<h2 class="eyebrow">how it felt</h2>
	<p class="text-muted mt-0.5 mb-4 flex max-w-2xl items-start gap-1.5 text-xs">
		<Lock size={13} class="mt-px shrink-0" />
		<span>
			Two rides with the same watts can feel nothing alike. Sharing a ride
			shares its numbers — this stays on your account, always.
		</span>
	</p>

	{#if error}
		<div class="mb-4">
			<Banner tone="error">
				{error}
				{#snippet action()}
					<button class="btn-link text-xs" onclick={() => void save()}
						>Retry</button
					>
				{/snippet}
			</Banner>
		</div>
	{/if}

	<fieldset>
		<legend class="eyebrow mb-2">how hard it felt</legend>
		<!-- Five per row on a phone keeps every target past ux.md's 44 px; ten
		     across from sm up, where the whole scale reads as one line. -->
		<div class="grid max-w-lg grid-cols-5 gap-1.5 sm:grid-cols-10">
			{#each RPE_SCALE as n (n)}
				<button
					type="button"
					aria-pressed={rpe === n}
					title="{n} — {rpeLabel(n)}"
					onclick={() => (rpe = rpe === n ? null : n)}
					class="btn min-h-11 px-0 tabular-nums {rpe === n
						? 'btn-primary'
						: 'btn-secondary'}">{n}</button
				>
			{/each}
		</div>
		<p class="text-muted mt-2 text-xs">
			{#if rpe === null}
				1 very easy · 10 maximal. Tap a number, or leave it — nothing needs it.
			{:else}
				{rpe} — {rpeLabel(rpe)}. Tap it again to un-rate the ride.
			{/if}
		</p>
	</fieldset>

	<div class="mt-5">
		<label for="ride-note" class="eyebrow">what you'd tell yourself</label>
		<textarea
			id="ride-note"
			bind:value={note}
			rows="2"
			aria-invalid={tooLong}
			aria-describedby="ride-note-count"
			placeholder="Legs were dead, third day on."
			class="input mt-2 block w-full resize-y"></textarea>
		<p
			id="ride-note-count"
			class="mt-1.5 text-xs {tooLong ? 'text-danger' : 'text-muted'}"
		>
			{#if tooLong}
				{-left} characters too many — a note is up to {MaxRideNoteChars}.
			{:else if left <= 50}
				{left} characters left.
			{:else}
				A sentence is plenty. Six weeks from now it is the only thing the
				numbers cannot tell you.
			{/if}
		</p>
	</div>

	<div class="mt-4 flex flex-wrap items-center gap-3">
		<button
			type="button"
			onclick={() => void save()}
			disabled={!changed || tooLong || saving}
			class="btn btn-primary btn-lg">{saving ? 'Saving…' : 'Save'}</button
		>
		{#if anything}
			<button
				type="button"
				onclick={() => {
					rpe = null;
					note = '';
				}}
				class="btn btn-ghost btn-xs">Clear</button
			>
		{/if}
		{#if !changed && (feel.rpe !== null || feel.note !== null)}
			<span class="text-muted text-xs">Saved.</span>
		{/if}
	</div>
</section>
