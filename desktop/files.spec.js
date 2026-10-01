// What the installer carries (#3497). electron-builder packages only what
// package.json's build.files lists, and the smoke runs the unpackaged shell
// where every file is on disk — so a module missing from the list passes CI
// and ships an app that cannot start ("Cannot find module './visibility'").
// reached.js walks every relative require and __dirname file from main.js
// and the preload, as plain Node; this checks the list covers each one, and
// that the release's own check (asar-check.js) reads an archive right.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const { reached } = require('./reached');
const { missingFrom } = require('./asar-check');

const listed = require('./package.json').build.files;

/** A build.files entry as a test: a plain path, or one `*` in the last segment. */
const covers = (pattern, file) =>
	new RegExp(
		`^${pattern
			.split('*')
			.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
			.join('[^/]*')}$`,
	).test(file);

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

/** A minimal asar: the 16-byte Pickle prefix, the JSON header, no contents. */
function asarOf(files) {
	const tree = { files: {} };
	for (const f of files) {
		let node = tree;
		const parts = f.split('/');
		for (const dir of parts.slice(0, -1)) node = node.files[dir] ??= { files: {} };
		node.files[parts.at(-1)] = { size: 0, offset: '0' };
	}
	const json = Buffer.from(JSON.stringify(tree));
	const padded = Math.ceil(json.length / 4) * 4;
	const head = Buffer.alloc(16 + padded);
	head.writeUInt32LE(4, 0);
	head.writeUInt32LE(8 + padded, 4);
	head.writeUInt32LE(4 + padded, 8);
	head.writeUInt32LE(json.length, 12);
	json.copy(head, 16);
	const file = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wattroom-asar-')), 'app.asar');
	fs.writeFileSync(file, head);
	return file;
}

test('the release check reads an archive and names what it leaves out (#3508)', () => {
	const all = reached();
	expect(missingFrom(asarOf(all))).toEqual([]);
	expect(missingFrom(asarOf(all.filter((f) => f !== 'visibility.js')))).toEqual(['visibility.js']);
	expect(missingFrom(asarOf(all.filter((f) => !f.startsWith('icons/'))))).toEqual(all.filter((f) => f.startsWith('icons/')));
});
