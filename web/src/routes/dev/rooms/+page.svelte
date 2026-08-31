<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { rooms } from '../room/mockRoom.svelte';

	// The two states that decide whether anyone comes back: your first visit, and every visit after.
	let firstRun = $state(false);
	// errors.md: every page owes four states. This is the one that was missing.
	let loading = $state(false);
	let joinCode = $state('');

	const invalidCode = $derived(
		joinCode.length > 0 && !/^[A-Z0-9]{0,6}$/i.test(joinCode),
	);
</script>

<main class="mx-auto max-w-3xl px-6 py-10">
	<div class="flex items-center justify-between gap-4">
		<h1 class="font-display text-3xl font-bold tracking-tight">Rooms</h1>
		<div class="text-muted flex items-center gap-4 text-xs">
			<label class="flex items-center gap-2">
				<input type="checkbox" bind:checked={loading} /> loading
			</label>
			<label class="flex items-center gap-2">
				<input type="checkbox" bind:checked={firstRun} /> first visit
			</label>
		</div>
	</div>

	{#if loading}
		<div class="mt-8 grid gap-3">
			{#each { length: 4 } as _, i (i)}
				<div class="border-muted/15 rounded-lg border px-5 py-4">
					<Skeleton class="h-4 w-48" />
					<Skeleton class="mt-2 h-3 w-28" />
				</div>
			{/each}
		</div>
	{:else if firstRun}
		<!--
			.claude/rules/ux.md: empty states teach, never apologise. One line on what the
			thing is, then the CTA that creates the first one. It is the only onboarding
			most people will read.
		-->
		<div
			class="border-muted/15 bg-surface-raised mt-8 rounded-lg border p-10 text-center"
		>
			<Logo size={56} />
			<h2 class="font-display mt-6 text-2xl font-bold">
				A room is a place, not a session.
			</h2>
			<p class="text-muted mx-auto mt-3 max-w-md text-sm leading-relaxed">
				You open one once and it stays. Your crew drops in, voices connect,
				someone queues music, and when a coach picks a workout everyone rides it
				at their own FTP.
			</p>
			<div class="mt-7 flex justify-center gap-3">
				<button
					class="bg-ink text-paper hover:bg-ink/90 rounded px-5 py-3 text-sm font-semibold"
					>Open your first room</button
				>
				<button
					class="border-muted/30 hover:border-muted/60 rounded border px-5 py-3 text-sm"
					>I have a code</button
				>
			</div>
		</div>
	{:else}
		<div class="mt-8 grid gap-3">
			{#each rooms as room (room.name)}
				<a
					href="/dev/room"
					class="border-muted/15 bg-surface-raised hover:border-muted/40 flex items-center gap-4 rounded-lg border px-5 py-4 transition-colors"
				>
					<div class="min-w-0">
						<p class="font-display font-bold">{room.name}</p>
						<p class="text-muted mt-0.5 text-xs">
							{#if room.live}
								riding now · {room.members} in the room
							{:else if room.members > 0}
								{room.members} in the lounge
							{:else}
								<!-- Quiet room: say what to do, not just that it's empty. -->
								empty — open it and your crew gets a ping
							{/if}
						</p>
					</div>
					{#if room.live}
						<span
							class="bg-watt glow-stroke ml-auto h-2 w-2 shrink-0 rounded-full"
						></span>
					{/if}
				</a>
			{/each}
		</div>

		<section class="border-muted/15 mt-8 rounded-lg border p-5">
			<div class="flex items-baseline gap-3">
				<h2 class="font-display font-bold">
					Thursday Sufferfest · medal history
				</h2>
				<span class="text-muted ml-auto font-mono text-[11px] tabular-nums"
					>14 sessions</span
				>
			</div>
			<ul class="mt-4 space-y-2">
				{#each [{ date: '21 Aug', medals: [{ n: 'Metronome', who: 'Sara' }, { n: 'Hammer', who: 'Ruben' }, { n: 'Diesel', who: 'Nina' }] }, { date: '19 Aug', medals: [{ n: 'Metronome', who: 'You' }, { n: 'Hammer', who: 'Ruben' }, { n: 'Lanterne Rouge', who: 'Milo' }] }, { date: '14 Aug', medals: [{ n: 'Diesel', who: 'Tobi' }, { n: 'Metronome', who: 'Nina' }, { n: 'Hammer', who: 'Sara' }] }] as session (session.date)}
					<li class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
						<span class="text-muted w-14 shrink-0 font-mono tabular-nums"
							>{session.date}</span
						>
						{#each session.medals as medal (medal.n)}
							<span class="text-muted">
								{medal.n}
								<span class={medal.who === 'You' ? 'text-watt' : 'text-ink'}
									>{medal.who}</span
								>
							</span>
						{/each}
					</li>
				{/each}
			</ul>
			<p class="text-muted mt-4 text-xs">
				Room streak: <span class="text-ink">4 weeks</span> — everyone rode at least
				once each week.
			</p>
		</section>

		<div class="mt-3 grid gap-3 sm:grid-cols-2">
			<div class="border-muted/15 rounded-lg border p-5">
				<h2 class="font-display font-bold">Invite to Thursday Sufferfest</h2>
				<p class="text-muted mt-1 text-xs">
					The link is the golden path — it works on any device without typing.
				</p>
				<div
					class="border-muted/25 mt-3 flex items-center gap-2 rounded border px-3 py-2"
				>
					<span class="truncate font-mono text-xs"
						>wattroom.ch/r/velvet-hammer</span
					>
					<button class="text-muted hover:text-ink ml-auto shrink-0 text-xs"
						>Copy</button
					>
				</div>
				<div class="mt-2 flex items-center gap-3">
					<span class="font-mono text-lg tracking-[0.3em] tabular-nums"
						>K7QM2P</span
					>
					<span class="text-muted text-[11px]"
						>for TVs and phones that can't open a link</span
					>
					<button class="text-muted hover:text-ink ml-auto shrink-0 text-[11px]"
						>Regenerate</button
					>
				</div>
			</div>

			<div class="border-muted/15 rounded-lg border p-5">
				<h2 class="font-display font-bold">Open a room</h2>
				<p class="text-muted mt-1 text-xs">
					Private by default. Share the link or the code with whoever you ride
					with.
				</p>
				<input
					class="border-muted/25 placeholder:text-muted/60 focus:border-muted/60 mt-3 w-full rounded border bg-transparent px-3 py-2 text-sm outline-none"
					placeholder="Room name"
				/>
				<button
					class="bg-ink text-paper hover:bg-ink/90 mt-3 w-full rounded px-4 py-2.5 text-sm font-medium"
					>Open room</button
				>
			</div>

			<div class="border-muted/15 rounded-lg border p-5">
				<h2 class="font-display font-bold">Join with a code</h2>
				<p class="text-muted mt-1 text-xs">
					Six characters, from whoever invited you.
				</p>
				<input
					bind:value={joinCode}
					maxlength="6"
					class="mt-3 w-full rounded border bg-transparent px-3 py-2 font-mono text-sm tracking-[0.3em] uppercase outline-none placeholder:tracking-normal placeholder:normal-case {invalidCode
						? 'border-z6/60'
						: 'border-muted/25 focus:border-muted/60'}"
					placeholder="Room code"
				/>
				<!-- Field-level validation lands under the field (.claude/rules/errors.md). -->
				{#if invalidCode}
					<p class="text-z6 mt-1.5 text-xs">
						Codes are letters and numbers only.
					</p>
				{/if}
				<button
					disabled={joinCode.length !== 6 || invalidCode}
					class="border-muted/30 hover:border-muted/60 mt-3 w-full rounded border px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
					>Join room</button
				>
			</div>
		</div>
	{/if}
</main>
