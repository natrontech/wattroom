<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import {
		detectOS,
		formatBytes,
		isNewer,
		latestRelease,
		shellSelfUpdates,
		shellVersion,
		type DesktopRelease,
		type OS,
	} from '$lib/desktop';

	// /download (#296): the desktop app, for the computer you are reading
	// this on. Public — a rider hears about it before they have an account.
	const os = detectOS(navigator.userAgent);
	const shell = shellVersion();

	// undefined while the feed answers, null when there is no build to offer.
	let release = $state<DesktopRelease | null | undefined>(undefined);
	void latestRelease().then((r) => (release = r));

	const NAMES: Record<OS, string> = {
		mac: 'macOS',
		windows: 'Windows',
		linux: 'Linux',
		phone: 'a phone',
		other: 'your computer',
	};
	const yours = $derived(release?.installers.filter((i) => i.os === os) ?? []);
	const others = $derived(release?.installers.filter((i) => i.os !== os) ?? []);
	const newer = $derived(
		!!shell && !!release && isNewer(release.version, shell),
	);

	/** First launch, per OS — what happens and what to click (errors.md). */
	const notes: { os: OS; title: string; steps: string[] }[] = [
		{
			os: 'mac',
			title: 'macOS',
			steps: [
				'Open the .dmg and drag WattRoom into Applications. It is signed and notarized, so it opens without a warning.',
				'macOS asks for Bluetooth the first time you pair a trainer, and for the microphone the first time you join voice. Allow both — without them the trainer stays invisible and the room cannot hear you.',
			],
		},
		{
			os: 'windows',
			title: 'Windows',
			steps: [
				'Run the installer. Windows shows "Windows protected your PC" because the app is new to it: click More info, then Run anyway. It asks once.',
			],
		},
		{
			os: 'linux',
			title: 'Linux',
			steps: [
				'AppImage: make it executable and run it — chmod +x WattRoom-*.AppImage.',
				'Debian and Ubuntu: sudo apt install ./wattroom-desktop_*.deb puts it in your app menu.',
			],
		},
	];
	const shown = $derived(
		os === 'mac' || os === 'windows' || os === 'linux'
			? notes.filter((n) => n.os === os)
			: notes,
	);
</script>

<svelte:head>
	<title>Download · WattRoom</title>
</svelte:head>

<h1 class="font-display mt-10 text-2xl font-bold">WattRoom on your desk</h1>
<p class="text-muted mt-2 max-w-prose text-sm leading-relaxed">
	The same WattRoom, in a window of its own. Your machine stays awake through an
	interval, nothing throttles it when you switch away, and your trainer pairs
	the moment you open it.
</p>

{#if shell}
	<p class="panel mt-6 px-4 py-3 text-sm">
		You are on the desktop app <span class="font-mono">{shell}</span>
		{#if newer && release && shellSelfUpdates()}
			<!-- The shell fetches it itself (#1303); the restart is on Home. -->
			— <span class="font-medium">{release.version} is out.</span> The app is fetching
			it on its own; restart when Home offers it.
		{:else if newer && release}
			— <span class="font-medium">{release.version} is out.</span>
		{:else if release}
			— the newest there is.
		{/if}
	</p>
{/if}

{#if release === undefined}
	<div class="mt-8 space-y-3">
		<Skeleton class="h-12" /><Skeleton class="h-6 w-2/3" />
	</div>
{:else if release === null}
	<div class="mt-8">
		<EmptyState>
			No desktop build is published yet. WattRoom runs in Chrome or Edge in the
			meantime — everything works there too.
		</EmptyState>
	</div>
{:else}
	<section class="mt-8">
		<p class="eyebrow">for {NAMES[os]}</p>
		{#if os === 'phone'}
			<p class="text-muted mt-2 text-sm leading-relaxed">
				The desktop app is for a computer. On a phone, WattRoom is a spectator
				in the browser — join a room and watch the ride.
			</p>
		{:else if yours.length === 0}
			<p class="text-muted mt-2 text-sm leading-relaxed">
				Version {release.version} has no installer for {NAMES[os]}. The ones
				below are for other systems.
			</p>
		{:else}
			<div class="mt-3 flex flex-wrap items-center gap-3">
				{#each yours as installer, i (installer.name)}
					<a
						href={installer.url}
						class="btn btn-lg {i === 0 ? 'btn-primary' : 'btn-secondary'}"
					>
						<Download size={18} />
						{i === 0 ? `Download ${release.version}` : installer.name}
						{#if installer.bytes}
							<span class="text-xs opacity-70"
								>{formatBytes(installer.bytes)}</span
							>
						{/if}
					</a>
				{/each}
			</div>
		{/if}
	</section>

	{#if others.length}
		<section class="mt-8">
			<p class="eyebrow">also for</p>
			<ul class="mt-3 flex flex-wrap gap-3">
				{#each others as installer, i (i)}
					<li>
						<a href={installer.url} class="btn btn-secondary">
							{NAMES[installer.os]} · {installer.name.replace(/^.*\./, '')}
							{#if installer.bytes}
								<span class="text-xs opacity-70"
									>{formatBytes(installer.bytes)}</span
								>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="mt-10">
		<p class="eyebrow">first launch</p>
		{#each shown as note (note.os)}
			{#if shown.length > 1}
				<h2 class="font-display mt-4 text-sm font-semibold">{note.title}</h2>
			{/if}
			<ol
				class="text-muted mt-2 max-w-prose list-decimal space-y-2 pl-5 text-sm leading-relaxed"
			>
				{#each note.steps as step}
					<li>{step}</li>
				{/each}
			</ol>
		{/each}
	</section>

	<p class="text-muted mt-10 text-xs">
		<a href={release.page} class="hover:text-ink underline"
			>Release notes, and every version</a
		>
	</p>
{/if}
