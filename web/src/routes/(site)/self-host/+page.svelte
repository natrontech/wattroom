<script lang="ts">
	import CtaBand from '$lib/site/CtaBand.svelte';
	import Faq from '$lib/site/Faq.svelte';
	import PageHero from '$lib/site/PageHero.svelte';
	import SectionHead from '$lib/site/SectionHead.svelte';
	import Seo from '$lib/site/Seo.svelte';
	import { REPO, SELF_HOST } from '$lib/site/seo';

	// For clubs and tinkerers (#2995): what running your own WattRoom takes.
	// deploy/README.md is the reference; this page points at it rather than
	// becoming a second copy that drifts.
	const stack = [
		{
			name: 'wattroom-server',
			body: 'One Go binary with the web app built in. It serves the pages, the API and the live sessions, and migrates its own database at boot.',
		},
		{
			name: 'PostgreSQL',
			body: 'Everything that has to last: accounts, crews, channels, workouts, rides. Live session state lives in the server’s memory, never here.',
		},
		{
			name: 'LiveKit',
			body: 'The self-hosted media server that carries voice and camera. Nothing is recorded — it forwards, it does not store.',
		},
		{
			name: 'Caddy',
			body: 'TLS and the reverse proxy, in the same Compose file. Swap it for your own edge if you already have one.',
		},
	];

	const commands = `mkdir -p /opt/wattroom && cd /opt/wattroom
# copy the repository's deploy/ directory here
cp .env.example .env                    # fill it in
cp livekit.yaml.example livekit.yaml    # same keys as .env
docker compose -f docker-compose.prod.yml up -d`;

	const faq = [
		{
			q: 'What does it need to run?',
			a: 'One VM with Docker and Compose. Two vCPUs and 4 GB of memory is plenty for a club. Open 80 and 443, plus LiveKit’s ports and its UDP range for voice.',
		},
		{
			q: 'How do updates work?',
			a: 'Every release is a tagged image on the GitHub Container Registry. Set the new tag in .env, pull, and bring the server up again. A rollback is the same with the previous tag — releases only ever add to the database, so the older image still runs.',
		},
		{
			q: 'How do people sign in?',
			a: 'With Google, GitHub or Strava — you register your own OAuth apps — and with a passkey once a rider has an account. Any provider you leave unset simply does not show a button.',
		},
		{
			q: 'What does the AGPL ask of me?',
			a: 'Run it as it is and nothing. If you change the code and let other people use your changed version over the network, you share those changes under the same license.',
		},
	];
</script>

<Seo page={SELF_HOST} />

<PageHero
	eyebrow="Open source · AGPL-3.0"
	title="Run your club’s own WattRoom"
	lede="WattRoom is free software. The whole stack — server, web app, voice — runs from one Docker Compose file on one small VM, and your riders’ data never leaves it."
>
	<a href={REPO} class="btn btn-primary btn-lg">Source on GitHub</a>
	<a href="{REPO}/blob/main/deploy/README.md" class="btn btn-secondary btn-lg"
		>Deploy guide</a
	>
</PageHero>

<section class="mx-auto w-full max-w-6xl px-4 sm:px-6">
	<SectionHead
		eyebrow="The stack"
		title="Four containers, deliberately boring"
	/>
	<div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each stack as part, i (i)}
			<div class="panel panel-lg">
				<h3 class="num font-bold">{part.name}</h3>
				<p class="text-muted mt-2 text-sm leading-relaxed">{part.body}</p>
			</div>
		{/each}
	</div>
</section>

<section class="mx-auto mt-24 w-full max-w-4xl px-4 sm:px-6">
	<SectionHead
		eyebrow="First deploy"
		title="Three files and one command"
		lede="The deploy directory in the repository is the reference; .env.example explains every value, and what happens when an optional one stays empty."
	/>
	<pre class="panel panel-lg mt-6 overflow-x-auto text-sm leading-relaxed"><code
			>{commands}</code
		></pre>
	<p class="text-muted mt-4 text-sm">
		Then <code>curl https://your.host/api/healthz</code> answers
		<code>ok</code>. The full guide, including how LiveKit reaches the server
		and what to back up, is in
		<a href="{REPO}/blob/main/deploy/README.md" class="hover:text-ink underline"
			>deploy/README.md</a
		>.
	</p>
</section>

<div class="mt-24">
	<Faq items={faq} />
</div>

<CtaBand
	title="Or ride on ours."
	line="wattroom.ch is the same code, run for anyone who wants it. Start a crew there tonight, and run your own whenever you like."
/>
