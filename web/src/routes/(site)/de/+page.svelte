<script lang="ts">
	import CtaBand from '#lib/site/CtaBand.svelte';
	import Faq from '#lib/site/Faq.svelte';
	import GameModeCards from '#lib/site/GameModeCards.svelte';
	import PageHero from '#lib/site/PageHero.svelte';
	import Screen from '#lib/site/Screen.svelte';
	import SectionHead from '#lib/site/SectionHead.svelte';
	import Seo from '#lib/site/Seo.svelte';
	import { GERMAN } from '#lib/site/seo.ts';

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
			titel: 'Session starten',
			text: 'Wer im Sprachkanal ist, startet eine Session: eine freie Fahrt auf einer Strecke, ein Workout, ein Rennen oder ein Spiel. Alle fahren gleichzeitig — und ihr redet die ganze Zeit.',
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
			q: 'Woher kommen die Strecken?',
			a: 'Von dir. Importiere eine GPX-, TCX- oder FIT-Datei einer Strecke, die du kennst, und WattRoom liest daraus die Steigungen und Anstiege. Auf jedem Gerät wählst du: die Strecke in 3D oder flach als Höhenprofil.',
		},
		{
			q: 'Gibt es Rennen?',
			a: 'Ja, innerhalb deiner Crew. Strecke wählen, «Race it» tippen und Race, Last Light oder Wheelrace fahren. Das Tempo kommt aus deinen W/kg, am Hinterrad fährst du im Windschatten wie in einem echten Feld, und die Rangliste gibt es pro Kategorie, D bis A. Einen öffentlichen Rennkalender gibt es nicht.',
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
		lede="Fahrt eure eigenen Strecken in einer 3D-Welt, mit der ganzen Crew darauf, oder ein strukturiertes Workout, jede Rolle auf die FTP ihres Fahrers. Der Sprachkanal ist eingebaut, damit ihr gemeinsam leiden könnt. Ohne Abo, direkt im Browser."
	>
		<a href="/login" class="btn btn-primary btn-lg">Crew gründen</a>
		<a href="/" class="btn btn-secondary btn-lg" hreflang="en">English</a>
	</PageHero>

	<section class="mx-auto w-full max-w-5xl px-4 sm:px-6">
		<Screen
			name="world-crew"
			eager
			alt="Zwei Fahrerinnen einer Crew nebeneinander in einer Session auf einer Strasse durch den Bergwald in der 3D-Welt, die eine mit einem Papagei auf der Schulter, die andere mit einem Hamster auf dem Kopf; oben die Watt und die Uhr des Blocks, rechts die Watt pro Kilo, unten die Grafik des Workouts"
			width={1440}
			height={900}
			caption="Eure Strecke in 3D, die Zahlen aller Fahrer, und der Sprachkanal, in dem ihr fahrt. (Die App ist auf Englisch.)"
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
					Eigene Strecken in 3D: GPX, TCX oder FIT importieren und mit der Crew
					darauf fahren.
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
					Keine Power-ups. Spiele: nur Watt. Rennen: ein echtes Feld, mit
					Windschatten.
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
			eyebrow="Rennen und Spiele"
			title="Fahrt Rennen auf euren Strecken, oder spielt nur mit Watt"
			lede="Strecke in der Session-Auswahl wählen, «Race it» tippen und Race, Last Light oder Wheelrace wählen: ein Rennen nach W/kg, mit Rangliste pro Kategorie am Schluss. Oder eines von sieben Spielen, die an der eigenen FTP messen — so kann auch der schwächste Motor der Crew gewinnen. (Die Namen sind englisch, wie die App.)"
		/>
		<div class="mt-10">
			<Screen
				name="race-picker"
				alt="Die Session-Auswahl mit einer gewählten Strecke und ihren Rennen: Race, Last Light und Wheelrace"
				width={1440}
				height={900}
				caption="«Race it», direkt in der Session-Auswahl."
			/>
		</div>
		<div class="mt-8" lang="en">
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
