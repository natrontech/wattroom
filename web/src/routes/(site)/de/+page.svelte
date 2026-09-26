<script lang="ts">
	import CtaBand from '$lib/site/CtaBand.svelte';
	import Faq from '$lib/site/Faq.svelte';
	import GameModeCards from '$lib/site/GameModeCards.svelte';
	import PageHero from '$lib/site/PageHero.svelte';
	import Screen from '$lib/site/Screen.svelte';
	import SectionHead from '$lib/site/SectionHead.svelte';
	import Seo from '$lib/site/Seo.svelte';
	import { GERMAN } from '$lib/site/seo';

	// The one German page (#2995): "Zwift Alternative kostenlos / ohne Abo /
	// mit Freunden" is real demand in Switzerland and Germany. It says plainly
	// that the app itself is in English — a rider who finds that out after
	// signing up was misled by this page.
	const schritte = [
		{
			titel: 'Crew gründen',
			text: 'Deine Crew bekommt Text- und Sprachkanäle, wie ein Discord-Server für den Pain Cave. Den sechsstelligen Code teilen — alle sind drin.',
		},
		{
			titel: 'Sprachkanal, Rolle koppeln',
			text: 'Chrome oder Edge verbindet sich per Bluetooth mit deinem Smart Trainer. Nichts installieren. Kamera nach Lust, Mikrofon mit einem Tipp.',
		},
		{
			titel: 'Gemeinsam ein Workout fahren',
			text: 'Wer im Kanal ist, startet ein Workout. Jede Rolle hält die Watt ihres Fahrers, die Zeitleiste läuft für alle gleichzeitig — und ihr redet die ganze Zeit.',
		},
	];

	const faq = [
		{
			q: 'Ist WattRoom wirklich kostenlos?',
			a: 'Ja. Kein Abo, keine Testphase, kein Bezahlmodell. WattRoom ist Open Source (AGPL), und jeder kann einen eigenen Server betreiben.',
		},
		{
			q: 'Gibt es die App auf Deutsch?',
			a: 'Noch nicht: Die App selbst ist auf Englisch. Die Bedienung ist bewusst einfach gehalten — grosse Knöpfe, wenig Text, gebaut für jemanden, der schwitzend drei Meter vom Bildschirm entfernt sitzt.',
		},
		{
			q: 'Was brauche ich?',
			a: 'Einen Smart Trainer mit Bluetooth FTMS (das können die meisten aktuellen Rollen) und Chrome oder Edge auf Windows, macOS oder Android — oder die Desktop-App. Auf iPhone und iPad kannst du der Crew und dem Sprachkanal beitreten, aber nicht fahren.',
		},
		{
			q: 'Können unterschiedlich starke Fahrer zusammen trainieren?',
			a: 'Genau dafür ist WattRoom da. Jede Vorgabe ist ein Prozentsatz der eigenen FTP: Wer 180 W und wer 320 W FTP hat, fährt dasselbe Workout nebeneinander, und es tut beiden gleich weh.',
		},
		{
			q: 'Kann ich meine Zwift-Workouts mitnehmen?',
			a: 'Ja: .zwo- und .erg-Dateien lassen sich im Workout-Editor importieren.',
		},
		{
			q: 'Wird etwas aufgezeichnet?',
			a: 'Sprache und Video werden nie aufgezeichnet. Deine Fahrten sind standardmässig privat, und du kannst alles exportieren oder löschen.',
		},
	];
</script>

<Seo page={GERMAN} />

<div lang="de">
	<PageHero
		eyebrow="Die kostenlose Zwift-Alternative"
		title="Rollentraining mit Freunden statt allein"
		lede="Eine Crew, ein strukturiertes Workout, jede Rolle auf die FTP ihres Fahrers — und ein Sprachkanal, damit ihr gemeinsam leiden könnt. Ohne Abo, ohne Installation, direkt im Browser. Keine virtuelle Welt: Deine Watt sind das Spiel."
	>
		<a href="/login" class="btn btn-primary btn-lg">Crew gründen</a>
		<a href="/" class="btn btn-secondary btn-lg" hreflang="en">English</a>
	</PageHero>

	<section class="mx-auto w-full max-w-5xl px-4 sm:px-6">
		<Screen
			name="session"
			eager
			alt="Eine laufende WattRoom-Session: Watt und Puls jedes Fahrers neben der gemeinsamen Intervall-Zeitleiste"
			caption="Eine Zeitleiste, die Zahlen aller Fahrer, und der Sprachkanal, in dem ihr fahrt. (Die App ist auf Englisch.)"
		/>
	</section>

	<section class="mx-auto mt-24 w-full max-w-6xl px-4 sm:px-6">
		<SectionHead
			center
			eyebrow="So geht’s"
			title="Vom Gruppenchat zur Gruppenausfahrt"
		/>
		<ol class="mt-10 grid gap-4 md:grid-cols-3">
			{#each schritte as s, i (s.titel)}
				<li class="panel panel-lg">
					<span
						class="font-display border-neon/50 grid h-9 w-9 place-items-center rounded-full border text-sm font-bold"
						>{i + 1}</span
					>
					<h3 class="font-display mt-4 text-lg font-bold">{s.titel}</h3>
					<p class="text-muted mt-2 text-sm leading-relaxed">{s.text}</p>
				</li>
			{/each}
		</ol>
	</section>

	<section
		class="mx-auto mt-24 grid w-full max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-2"
	>
		<div>
			<SectionHead eyebrow="Warum WattRoom" title="Ein Tab statt drei Apps" />
			<ul
				class="text-muted mt-5 flex list-disc flex-col gap-2 pl-5 leading-relaxed"
			>
				<li>
					Sprachkanal eingebaut — kein Discord nebenher, kein Meetup, das man
					zuerst einrichten muss.
				</li>
				<li>
					Ein gemeinsames Workout im ERG-Modus, jede Vorgabe auf deine eigene
					FTP skaliert.
				</li>
				<li>
					Eine gemeinsame Jukebox: YouTube-Links und Playlists laufen für alle
					synchron.
				</li>
				<li>
					Sieben Spielmodi, die nur über Watt entschieden werden — kein
					Windschatten, keine Power-ups.
				</li>
				<li>Jede Fahrt zählt: .fit-Export und Upload zu Strava.</li>
				<li>Open Source, kostenlos, gebaut in der Schweiz.</li>
			</ul>
		</div>
		<Screen
			name="crew"
			alt="Eine Crew in WattRoom: die Seitenleiste mit Text- und Sprachkanälen"
		/>
	</section>

	<section class="mx-auto mt-24 w-full max-w-6xl px-4 sm:px-6">
		<SectionHead
			center
			eyebrow="Sieben Spielmodi"
			title="Kein Windschatten. Nur Watt."
			lede="Jedes Spiel misst an der eigenen FTP — so kann auch der schwächste Motor der Crew gewinnen. (Die Namen der Modi sind englisch, wie die App.)"
		/>
		<div class="mt-10" lang="en">
			<GameModeCards />
		</div>
	</section>

	<div class="mt-24">
		<Faq items={faq} heading="Fragen" />
	</div>

	<CtaBand
		title="Deine Crew ist einen Link entfernt."
		line="Crew gründen, den Code teilen, und heute Abend das erste Workout gemeinsam fahren. Kostenlos, ohne Installation."
		start="Crew gründen"
		source="Zum Quellcode"
	/>
</div>
