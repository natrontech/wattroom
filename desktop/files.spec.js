// What the installer carries (#3497). electron-builder packages only what
// package.json's build.files lists, and the smoke runs the unpackaged shell
// where every file is on disk — so a module missing from the list passes CI
// and ships an app that cannot start ("Cannot find module './visibility'").
// This walks every relative require and __dirname file from main.js and the
// preload, as plain Node, and checks the list covers each one.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const listed = require('./package.json').build.files;

/** A build.files entry as a test: a plain path, or one `*` in the last segment. */
const covers = (pattern, file) =>
	new RegExp(
		`^${pattern
			.split('*')
			.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
			.join('[^/]*')}$`,
	).test(file);

/** Every file main.js and the preload reach: relative requires, followed, and paths joined onto __dirname. */
function reached() {
	const seen = new Set();
	const visit = (file) => {
		if (seen.has(file)) return;
		seen.add(file);
		if (!file.endsWith('.js')) return;
		const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
		for (const [, rel] of src.matchAll(/require\('\.\/([^']+)'\)/g))
			visit(path.extname(rel) ? rel : `${rel}.js`);
		for (const [, args] of src.matchAll(/path\.join\(__dirname,\s*([^)]*)\)/g)) {
			const parts = [...args.matchAll(/'([^']+)'/g)].map((m) => m[1]);
			// A ternary picks between names: each one is reached.
			if (parts.length && !args.includes('?')) visit(parts.join('/'));
			else for (const p of parts.filter((q) => q.includes('.'))) visit(path.posix.join(...parts.filter((q) => !q.includes('.')), p));
		}
	};
	visit('main.js');
	visit('preload.js');
	return [...seen].sort();
}

test('the installer carries every file the shell loads', () => {
	const files = reached();
	expect(files).toContain('preload.js');
	expect(files).toContain('offline.html');
	const missing = files.filter((f) => !listed.some((p) => covers(p, f)));
	expect(missing, 'add these to build.files in desktop/package.json').toEqual([]);
});

test('every file the installer lists exists', () => {
	const stale = listed.filter(
		(p) =>
			!fs
				.readdirSync(path.join(__dirname, path.dirname(p)))
				.some((f) => covers(p, path.posix.join(path.dirname(p), f))),
	);
	expect(stale).toEqual([]);
});
