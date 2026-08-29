<script lang="ts">
	import Logo from '$lib/brand/Logo.svelte';
	import { account } from '$lib/account.svelte';

	void account.load();

	// One teaching line per destination — the only onboarding most users read.
	const places = [
		{
			href: '/workouts',
			title: 'Workouts',
			line: 'The curated library and your own — pick what the room rides.',
		},
		{
			href: '/ramp',
			title: 'Ramp test',
			line: 'Twenty-ish minutes to an honest FTP.',
		},
		{
			href: '/pair',
			title: 'Sensors',
			line: 'Pair your trainer and heart rate strap over Bluetooth.',
		},
		{
			href: '/history',
			title: 'Rides',
			line: 'Every ride you have finished — private by default, always.',
		},
		{
			href: '/profile',
			title: 'Profile',
			line: 'FTP, weight, sign-in and your data.',
		},
	];
</script>

<main class="relative flex min-h-dvh flex-col">
	<!-- Horizon-grid backdrop band; never behind text (app.css). -->
	<div
		class="bg-gridlines pointer-events-none absolute inset-x-0 top-0 h-[45dvh] opacity-40"
		aria-hidden="true"
	></div>

	<section
		class="relative mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-6 py-16 text-center"
	>
		<Logo size={72} wordmark />
		<p class="text-muted mt-4 text-sm">Train together, not alone.</p>

		{#if !account.loaded}
			<div class="mt-10 h-11"></div>
		{:else if account.me}
			<a
				href="/rooms"
				class="mt-10 rounded bg-white px-6 py-3 text-sm font-semibold text-black hover:bg-white/90"
				>Open your rooms</a
			>
			<p class="text-muted mt-3 text-xs">
				Signed in as {account.me.displayName}
			</p>
		{:else}
			<a
				href="/rooms"
				class="mt-10 rounded bg-white px-6 py-3 text-sm font-semibold text-black hover:bg-white/90"
				>Sign in</a
			>
			<p class="text-muted mt-3 max-w-md text-xs">
				A room is a private space where your crew rides structured workouts
				together — live watts, voice, and games. Rooms need an account; riding
				alone doesn't.
			</p>
		{/if}

		<div
			class="mt-14 grid w-full gap-3 text-left sm:grid-cols-2 lg:grid-cols-3"
		>
			<a
				href="/rooms"
				class="border-neon/40 bg-surface-raised hover:border-neon/70 rounded-lg border p-5"
			>
				<h2 class="font-display font-bold">Rooms</h2>
				<p class="text-muted mt-1.5 text-xs">
					Your crews. Sessions, sprint moments, game modes — together.
				</p>
			</a>
			{#each places as place (place.href)}
				<a
					href={place.href}
					class="border-muted/15 bg-surface-raised hover:border-muted/40 rounded-lg border p-5"
				>
					<h2 class="font-display font-bold">{place.title}</h2>
					<p class="text-muted mt-1.5 text-xs">{place.line}</p>
				</a>
			{/each}
		</div>
	</section>
</main>
