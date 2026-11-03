/**
 * The theme catalogue for the server (#4098): the ride card and the poster
 * are drawn in Go, in the rider's appearance, and the colours have one
 * source — web/src/lib/themes.ts. This writes its derived tokens where the
 * og package embeds them. Generated and committed, and CI fails on drift,
 * like protocol.ts: `make themes` after editing themes.ts or palette.ts.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const web = fileURLToPath(new URL('..', import.meta.url));
const { module } = await runnerImport('./src/lib/themes.ts', {
	root: web,
	configFile: false,
	logLevel: 'silent',
});
const themes = module.THEMES.map(({ id, identity, family, tokens }) => ({
	id,
	identity,
	family,
	tokens,
}));
writeFileSync(
	new URL('../../server/internal/og/themes.json', import.meta.url),
	JSON.stringify(themes, null, '\t') + '\n',
);
