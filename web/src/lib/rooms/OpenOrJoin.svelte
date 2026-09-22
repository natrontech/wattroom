<script lang="ts">
	// Getting into a crew: starting one of your own (#2480), or joining one
	// with a code — Home's crew section, and what the sidebar's + points at.
	import { goto } from '$app/navigation';
	import { account } from '$lib/account.svelte';
	import Banner from '$lib/components/Banner.svelte';
	import { foundCrew, joinCrew } from '$lib/crew';
	import {
		administersNone,
		crewsOf,
		foundedCount,
		leadsWithJoining,
	} from '$lib/nav/crews';
	import { presence } from '$lib/presence.svelte';
	// The code lengths and the caps are the server's, generated (#2180): the
	// box that tells a friend's code from a crew's cannot disagree with the
	// door, nor the start button with the cap.
	import {
		CrewCodeLen,
		FriendCodeLen,
		MaxCrewNameChars,
		MaxFoundedCrews,
	} from '$lib/protocol';

	let {
		compact = false,
	}: {
		/**
		 * The sheet the sidebar's + opens (#1199): stacked, no section
		 * heading, the name field focused — the forms are the same.
		 */
		compact?: boolean;
	} = $props();

	const crews = $derived(crewsOf(presence.rooms, presence.crews));
	// A rider carrying an invite is asked to join that crew before founding
	// one (#2144, #2184): the code box leads and starting a crew is the second
	// panel. Keyed on the invite rather than on administering nothing, because
	// the signed-out landing promises a stranger their own crew and a stranger
	// is who arrives without one (ADR-0038 amended 2026-09-17).
	const joinFirst = $derived(
		presence.loaded && leadsWithJoining(crews, account.me?.pendingInvite),
	);
	// No crew of your own yet — the day-one heading.
	const crewless = $derived(presence.loaded && administersNone(crews));

	let crewName = $state('');
	let joinCode = $state('');
	let busy = $state(false);
	// One slot per form (errors.md): a refused code used to sit above the
	// other card, a card away from the field it was about.
	let startError = $state<string | null>(null);
	let joinError = $state<string | null>(null);

	const invalidCode = $derived(
		joinCode.length > 0 && !/^[A-Z0-9]*$/i.test(joinCode),
	);
	// A crew's code is six characters, a friend's eight (friends.go). The box
	// used to cut a pasted friend code to six and send it, and the server's
	// "no crew has that code" sent the rider back to the friend who gave them
	// the right code for a different door.
	const looksLikeFriendCode = $derived(
		joinCode.length > CrewCodeLen &&
			joinCode.length <= FriendCodeLen &&
			/^[A-Z0-9]+$/i.test(joinCode),
	);
	// docs/SPEC.md founding cap: at the cap the affordance disables with the
	// reason, instead of a refusal on click (ux.md capability gating); the
	// server still backs it up.
	const founded = $derived(foundedCount(crews));
	const foundedOut = $derived(founded >= MaxFoundedCrews);

	// Lands in the crew, which opens with a text and a voice channel.
	async function startCrew() {
		busy = true;
		const res = await foundCrew(crewName);
		busy = false;
		if (res.ok) {
			presence.reload();
			void goto(`/crew/${res.data.id}`);
		} else startError = res.error.message;
	}

	// The code is the crew's (ADR-0038 amended, #1236): joining lands on the
	// crew's page.
	async function joinByCode() {
		busy = true;
		const res = await joinCrew(joinCode);
		busy = false;
		if (res.ok) {
			presence.reload();
			void goto(`/crew/${res.data.id}`);
		} else joinError = res.error.message;
	}
</script>

<section id={compact ? undefined : 'rooms'}>
	{#if !compact}
		<!-- Named for what is under it (#2176): the panel leads with joining a
		     crew for an invited rider. A rider with no crew and no invite gets
		     the landing's own words back (#2184). -->
		<h2 class="eyebrow">
			{joinFirst
				? 'Get into a crew'
				: crewless
					? 'Start your crew'
					: 'Start or join a crew'}
		</h2>
	{/if}
	<div
		class="grid gap-3 {compact
			? 'grid-cols-1'
			: 'mt-3 sm:grid-cols-2 xl:grid-cols-1'}"
	>
		<!-- Two panels, and which comes first is a decision (ux.md): the
		     DOM order, not a CSS order, so the tab order and a reader agree
		     with the eye. -->
		{#snippet startPanel()}
			<div
				class={compact
					? joinFirst
						? 'border-ink/5 border-t pt-4'
						: ''
					: 'panel panel-lg'}
			>
				<h3 class="font-display font-bold">
					{joinFirst ? 'Or start a crew of your own' : 'Start a crew'}
				</h3>
				<p class="text-muted mt-1 text-xs">
					Yours to run. It opens with a text channel and a voice channel, and
					anyone joins with its code or link.
				</p>
				{#if startError}
					<div class="mt-3"><Banner tone="error">{startError}</Banner></div>
				{/if}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						void startCrew();
					}}
				>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id={compact ? 'start-crew-name-sheet' : 'start-crew-name'}
						bind:value={crewName}
						maxlength={MaxCrewNameChars}
						class="input mt-3 w-full"
						placeholder="Crew name"
						aria-label="crew name"
						autofocus={compact && !joinFirst}
					/>
					<button
						disabled={busy || !crewName.trim() || foundedOut}
						class="btn btn-primary mt-3 w-full">Start a crew</button
					>
					{#if foundedOut}
						<p class="text-muted mt-2 text-xs">
							You own the {founded} crews you founded — the most a rider starts. Hand
							one on to start another.
						</p>
					{/if}
				</form>
			</div>
		{/snippet}
		{#snippet joinPanel()}
			<div
				class={compact
					? joinFirst
						? ''
						: 'border-ink/5 border-t pt-4'
					: 'panel panel-lg'}
			>
				<h3 class="font-display font-bold">
					{compact && !joinFirst
						? 'Or join a crew with a code'
						: 'Join a crew with a code'}
				</h3>
				<p class="text-muted mt-1 text-xs">
					Six characters, from whoever invited you to their crew.
				</p>
				{#if joinError}
					<div class="mt-3"><Banner tone="error">{joinError}</Banner></div>
				{/if}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						void joinByCode();
					}}
				>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id={compact ? 'join-code-sheet' : 'join-code'}
						bind:value={joinCode}
						maxlength={FriendCodeLen}
						class="input mt-3 w-full font-mono tracking-[0.3em] uppercase placeholder:tracking-normal placeholder:normal-case"
						aria-invalid={invalidCode || looksLikeFriendCode
							? 'true'
							: undefined}
						placeholder="Crew code"
						aria-label="crew code"
						autofocus={compact && joinFirst}
					/>
					{#if invalidCode}
						<!-- Field-level validation lands under the field (errors.md). -->
						<p class="text-danger mt-1.5 text-xs">
							Codes are letters and numbers only.
						</p>
					{:else if looksLikeFriendCode}
						<p class="text-danger mt-1.5 text-xs">
							That looks like a friend code — friends are added on <a
								href="/friends"
								class="underline">Friends</a
							>. A crew's code is six characters.
						</p>
					{/if}
					<button
						disabled={busy || joinCode.length !== CrewCodeLen || invalidCode}
						class="btn btn-secondary mt-3 w-full">Join crew</button
					>
				</form>
				<!-- The directory is the other half of "join a room" (#1118), not a
			     place of its own — nav/pages.ts retires anything that is the
			     second half of a page here, and this is exactly that. -->
				<p class="text-muted mt-3 text-xs">
					No code? <a href="/crews/directory" class="underline">Find a crew</a> —
					it lists the crews that chose to be found.
				</p>
			</div>
		{/snippet}
		{#if joinFirst}
			{@render joinPanel()}
			{@render startPanel()}
		{:else}
			{@render startPanel()}
			{@render joinPanel()}
		{/if}
	</div>
</section>
