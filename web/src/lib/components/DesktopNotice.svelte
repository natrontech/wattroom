<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import {
		detectOS,
		formatBytes,
		installShellUpdate,
		isNewer,
		latestRelease,
		onShellUpdateReady,
		shellUpdateReady,
		shellVersion,
		type DesktopRelease,
		type Installer,
	} from '$lib/desktop';

	// The desktop app, on home (#296, #1235). Two riders, one panel:
	//
	// - inside the shell: the update nudge. Since #1303 the shell downloads
	//   the next build itself, so once one is waiting this is "Restart to
	//   update" — the one click that installs it, here on home and never
	//   mid-ride. Until then (a shell from before #1303, or a download still
	//   running) it is the download link, asked for once per page load, and
	//   a version waved away stays away.
	// - in a browser on a Mac, Windows or Linux machine: the offer — what the
	//   app buys, the installer for THIS machine, one Not-now that is
	//   remembered for good. A phone gets nothing: the app is for a desk.
	//
	// Home only, beside the what's-new notice and for the same reason: never
	// mid-ride (ux.md). Nothing renders until a release exists, so the button
	// can never fail.
	const SKIPPED = 'wattroom.desktop-skipped.v1';
	const OFFERED = 'wattroom.desktop-offer.v1';

	const running = shellVersion();
	const os = detectOS(navigator.userAgent);
	const desk = os === 'mac' || os === 'windows' || os === 'linux';

	let latest = $state<DesktopRelease | null>(null);
	let skipped = $state(read(SKIPPED));
	// What the shell has already downloaded (#1303): asked on mount, and
	// heard when a download finishes while this page is open.
	let ready = $state<string | null>(null);
	if (running) {
		void shellUpdateReady().then((v) => (ready = v));
		onShellUpdateReady((v) => (ready = v));
	}
	// Read once at mount: whether to ask the feed at all is decided here, and
	// a decline during this visit only has to hide the panel, not stop a
	// request that already went out.
	const declinedBefore = read(OFFERED) === 'no';
	let declined = $state(declinedBefore);
	if (running || (desk && !declinedBefore))
		void latestRelease().then((r) => (latest = r));

	const update = $derived(
		running &&
			latest &&
			isNewer(latest.version, running) &&
			skipped !== latest.version
			? latest
			: null,
	);
	const installer = $derived<Installer | null>(
		!running && desk && !declined && latest
			? (latest.installers.find((i) => i.os === os) ?? null)
			: null,
	);
	const NAMES = { mac: 'macOS', windows: 'Windows', linux: 'Linux' } as const;

	function read(key: string): string | null {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	}
	function write(key: string, value: string) {
		try {
			localStorage.setItem(key, value);
		} catch {
			/* no storage: the panel returns next load, the safe direction */
		}
	}
	function skip() {
		if (!latest) return;
		write(SKIPPED, latest.version);
		skipped = latest.version;
	}
	function decline() {
		write(OFFERED, 'no');
		declined = true;
	}
</script>

{#if ready}
	<!-- Downloaded and waiting (#1303). No "Not now": nothing happens until
	     the click, and quitting installs it anyway. -->
	<section class="panel mt-6 flex flex-wrap items-center gap-3 px-5 py-4">
		<div class="min-w-48 flex-1">
			<p class="eyebrow">desktop app</p>
			<p class="mt-1 text-sm">
				WattRoom {ready} is downloaded — you are on {running}. It installs when
				you restart.
			</p>
		</div>
		<button class="btn btn-primary" onclick={installShellUpdate}
			><RotateCw size={15} /> Restart to update</button
		>
	</section>
{:else if update}
	<section class="panel mt-6 flex flex-wrap items-center gap-3 px-5 py-4">
		<div class="min-w-48 flex-1">
			<p class="eyebrow">desktop app</p>
			<p class="mt-1 text-sm">
				WattRoom {update.version} is out — you are on {running}.
			</p>
		</div>
		<a href="/download" class="btn btn-primary">Get the update</a>
		<button class="btn-link text-xs" onclick={skip}>Not now</button>
	</section>
{:else if installer && desk}
	<section class="panel mt-6 px-5 py-4">
		<div class="flex flex-wrap items-start gap-x-6 gap-y-3">
			<div class="min-w-56 flex-1">
				<p class="eyebrow">desktop app</p>
				<p class="font-display mt-1 text-base font-bold">
					WattRoom on your desk
				</p>
				<p class="text-muted mt-1 text-sm leading-relaxed">
					The same rooms in a window of their own: your machine stays awake
					through an interval, the room can hear your computer's audio, and it
					opens straight to your crew.
				</p>
			</div>
			<div class="flex flex-col items-start gap-2">
				<a href={installer.url} class="btn btn-primary btn-lg">
					<Download size={18} />
					Download for {NAMES[os]}
					{#if installer.bytes}
						<span class="text-xs opacity-70"
							>{formatBytes(installer.bytes)}</span
						>
					{/if}
				</a>
				<div class="flex items-center gap-4 text-xs">
					<a href="/download" class="btn-link">Other systems and first launch</a
					>
					<button class="btn-link" onclick={decline}>Not now</button>
				</div>
			</div>
		</div>
	</section>
{/if}
