<script lang="ts">
	import LandingHero from '$lib/brand/LandingHero.svelte';
	import Logo from '$lib/brand/Logo.svelte';
	import { account } from '$lib/account.svelte';

	void account.load();
</script>

{#if !account.loaded}
	<!-- Hold: a signed-in rider must never flash the marketing page. -->
	<div class="grid min-h-dvh place-items-center" aria-busy="true"></div>
{:else if !account.me}
	<!-- The public face of wattroom.ch (#111): one screen tells the story. -->
	<main class="relative flex min-h-dvh flex-col overflow-hidden">
		<div
			class="bg-gridlines pointer-events-none absolute inset-x-0 top-0 h-[50dvh] opacity-40"
			aria-hidden="true"
		></div>

		<section
			class="relative mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-6 py-16 text-center"
		>
			<Logo size={64} wordmark />
			<h1
				class="font-display mt-6 text-3xl font-bold tracking-tight sm:text-4xl"
			>
				Train together, not alone.
			</h1>
			<p class="text-muted mx-auto mt-4 max-w-xl text-sm leading-relaxed">
				Discord for indoor cycling: structured workouts your whole crew rides at
				once, with voice, camera, sprint moments, game modes and a shared
				jukebox. No virtual world — your watts are the game.
			</p>

			<a
				href="/login"
				class="mt-8 rounded bg-white px-6 py-3 text-sm font-semibold text-black hover:bg-white/90"
				>Sign in and open your first room</a
			>

			<!-- The one glowing thing: a session in progress. -->
			<div class="mt-12 h-36 w-full max-w-2xl sm:h-44">
				<LandingHero />
			</div>

			<div class="mt-12 grid w-full gap-3 text-left sm:grid-cols-3">
				<div class="border-muted/15 bg-surface-raised rounded-lg border p-5">
					<h2 class="font-display font-bold">Rooms</h2>
					<p class="text-muted mt-1.5 text-xs leading-relaxed">
						Everyone rides the same timeline, scaled to their own FTP. Live
						watts on every tile, voice and camera in the room.
					</p>
				</div>
				<div class="border-muted/15 bg-surface-raised rounded-lg border p-5">
					<h2 class="font-display font-bold">Workouts &amp; games</h2>
					<p class="text-muted mt-1.5 text-xs leading-relaxed">
						A curated library, an editor, ERG control — and seven game modes
						where the sprint klaxon does the talking.
					</p>
				</div>
				<div class="border-muted/15 bg-surface-raised rounded-lg border p-5">
					<h2 class="font-display font-bold">Private by default</h2>
					<p class="text-muted mt-1.5 text-xs leading-relaxed">
						Metrics stay in the room, audio and video are never recorded, rides
						belong to you alone.
					</p>
				</div>
			</div>

			<p class="text-muted mt-10 text-xs">
				Chrome or Edge on desktop and Android · smart trainer with FTMS · free
				&amp; open source (AGPL) —
				<a
					href="https://github.com/natrontech/wattroom"
					class="underline hover:text-white">GitHub</a
				>
			</p>
		</section>
	</main>
{:else}
	<!-- Redirecting to /rooms (see the effect above). -->
	<div class="grid min-h-dvh place-items-center" aria-busy="true"></div>
{/if}
