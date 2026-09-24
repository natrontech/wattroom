import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { code, FILES } from '$lib/source-scan.test-helper';

/**
 * lib/room split in two (#2460): the voice channel — its socket, its call,
 * its stage and deck, the people in it — is `lib/channel`, and the session
 * that runs in one is `lib/session`. A session runs IN a channel, so session
 * imports channel and channel does not import session. Read from source,
 * like stacking.test.ts: the direction is a property of the import lines,
 * and nothing that renders would notice it going both ways.
 *
 * The channel reaches into the session at the seams below and nowhere else.
 * Each entry is one file and the session modules it may name — a new edge
 * has to be added here, with its reason, rather than arriving quietly.
 */
const CHANNEL_TO_SESSION: Record<string, { modules: string[]; why: string }> = {
	'lib/channel/ChannelShell.svelte': {
		modules: ['SessionLayers.svelte', 'session-sounds.svelte'],
		why: 'the shell mounts the session over its channel: its layers, and the cues that must sound on every page',
	},
	'lib/channel/Lounge.svelte': {
		modules: [
			'GamePanel.svelte',
			'PlanCard.svelte',
			'SessionControls.svelte',
			'SprintMoment.svelte',
			'TrainerOverview.svelte',
			'sensor-status',
		],
		why: "the channel's page shows the session running in it, and is where one is started — with the trainer card for a rider still unpaired (#2594), and the plan due in it (#2606)",
	},
	'lib/channel/connection.svelte.ts': {
		modules: ['ride.svelte', 'recording.svelte'],
		why: 'the trainer and what it recorded belong to the connection, not a page (#521)',
	},
	'lib/channel/riders.svelte.ts': {
		modules: ['recording.svelte'],
		why: 'the roster puts your own recorded numbers on your tile (a type only)',
	},
	'lib/channel/ChannelStatus.svelte': {
		modules: ['modes'],
		why: "a game's label in the status line; modes.ts imports from neither side",
	},
	'lib/channel/events.ts': {
		modules: ['modes'],
		why: "a game's label in its event line; modes.ts imports from neither side",
	},
};

/** Every module a file names: imports, re-exports, dynamic imports, mocks. */
const SPECIFIER =
	/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|vi\.\w+\(\s*)(['"])([^'"\n]+)\1/g;

const SRC = join(import.meta.dirname, '..', '..');
const specifiers = (file: string) =>
	[...code(readFileSync(join(SRC, file), 'utf8')).matchAll(SPECIFIER)].map(
		(m) => m[2],
	);

describe('lib/channel and lib/session (#2460)', () => {
	it('leaves nothing importing lib/room', () => {
		const offenders = FILES.flatMap((file) =>
			specifiers(file)
				.filter((spec) => /^\$lib\/room(\/|$)/.test(spec))
				.map((spec) => `  ${file}: ${spec}`),
		);
		expect(
			offenders,
			`lib/room is gone:\n${offenders.join('\n')}\n` +
				'Import from $lib/channel or $lib/session instead.',
		).toEqual([]);
	});

	it('keeps the channel from importing the session outside its seams', () => {
		const used = new Set<string>();
		const offenders = FILES.filter((file) =>
			file.startsWith('lib/channel/'),
		).flatMap((file) =>
			specifiers(file).flatMap((spec) => {
				const session = /^(?:\$lib\/session\/|\.\.\/session\/)(.+)$/.exec(spec);
				if (!session) return [];
				if (CHANNEL_TO_SESSION[file]?.modules.includes(session[1])) {
					used.add(`${file} -> ${session[1]}`);
					return [];
				}
				return [`  ${file}: ${spec}`];
			}),
		);
		expect(
			offenders,
			`lib/channel importing lib/session:\n${offenders.join('\n')}\n` +
				'A session runs in a channel, so the dependency points the other ' +
				'way. Move what both need into lib/channel (or out of both), or — ' +
				'if this really is a seam — add it to CHANNEL_TO_SESSION with why.',
		).toEqual([]);

		const unused = Object.entries(CHANNEL_TO_SESSION).flatMap(
			([file, { modules }]) =>
				modules
					.filter((module) => !used.has(`${file} -> ${module}`))
					.map((module) => `  ${file} -> ${module}`),
		);
		expect(
			unused,
			`Seams nothing uses any more — delete them:\n${unused.join('\n')}`,
		).toEqual([]);
	});
});
