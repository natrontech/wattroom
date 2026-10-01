// Every file the shell loads (#3497, #3508): relative requires from main.js
// and the preload, followed, and paths joined onto __dirname. files.spec.js
// holds build.files to it before a merge; asar-check.js holds each built
// app.asar to it before a release. Not packaged (package.json `files`).
const fs = require('node:fs');
const path = require('node:path');

function reached() {
	const seen = new Set();
	const visit = (file) => {
		if (seen.has(file)) return;
		seen.add(file);
		if (!file.endsWith('.js')) return;
		const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
		for (const [, rel] of src.matchAll(/require\('\.\/([^']+)'\)/g))
			visit(path.extname(rel) ? rel : `${rel}.js`);
		for (const [, args] of src.matchAll(
			/path\.join\(__dirname,\s*([^)]*)\)/g,
		)) {
			const parts = [...args.matchAll(/'([^']+)'/g)].map((m) => m[1]);
			// A ternary picks between names: each one is reached.
			if (parts.length && !args.includes('?')) visit(parts.join('/'));
			else
				for (const p of parts.filter((q) => q.includes('.')))
					visit(path.posix.join(...parts.filter((q) => !q.includes('.')), p));
		}
	};
	visit('main.js');
	visit('preload.js');
	return [...seen].sort();
}

module.exports = { reached };
