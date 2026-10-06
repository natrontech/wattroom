import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rideLook, type Paint } from './look';

const css = readFileSync(
	join(import.meta.dirname, '..', '..', 'app.css'),
	'utf8',
);

/** A token as app.css first declares it; a light-dark pair gives its dark half, as inside the cave. */
export const appCss: Paint = (token) => {
	const m = css.match(new RegExp(`--${token}:\\s*([^;]+);`));
	if (!m) throw new Error(`app.css declares no --${token}`);
	const dark = m[1].match(/light-dark\(\s*[^,]+,\s*([^)]+)\)/);
	return (dark ? dark[1] : m[1]).trim();
};

/** The ride's look as a test sees it: the tokens app.css declares. */
export const RIDE = rideLook(appCss);
