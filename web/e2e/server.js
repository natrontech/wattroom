// Serves the built SPA and proxies /api to the Go server, so the e2e run exercises
// the same two-process split production uses rather than a mock.
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const WEB_PORT = 4173;
const API_PORT = 8081;
const dist = new URL('../build/', import.meta.url).pathname;

const types = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.svg': 'image/svg+xml',
	'.woff2': 'font/woff2',
	'.json': 'application/json'
};

const go = spawn('go', ['run', '.'], {
	cwd: new URL('../../server/', import.meta.url).pathname,
	env: {
		...process.env,
		WATTROOM_ADDR: `:${API_PORT}`,
		// The login gate (ADR-0009) means even the e2e ride signs in — the dev
		// provider against a real Postgres, same doors production uses.
		WATTROOM_DB:
			process.env.WATTROOM_DB ??
			'postgres://wattroom:wattroom@localhost:5432/wattroom',
		WATTROOM_DEV_LOGIN: '1'
	},
	stdio: 'inherit'
});
process.on('exit', () => go.kill());
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		go.kill();
		process.exit(0);
	});
}

createServer((req, res) => {
	if (req.url.startsWith('/api/')) {
		const upstreamReq = httpRequest(
			{
				host: '127.0.0.1',
				port: API_PORT,
				path: req.url,
				method: req.method,
				headers: req.headers
			},
			(upstream) => {
				res.writeHead(upstream.statusCode, upstream.headers);
				upstream.pipe(res);
			}
		);
		upstreamReq.on('error', () => {
			res.writeHead(502).end('api unavailable');
		});
		req.pipe(upstreamReq);
		return;
	}

	const requested = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
	let file = join(dist, requested);
	if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
	res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
	createReadStream(file).pipe(res);
}).listen(WEB_PORT, () => console.log(`e2e web on :${WEB_PORT}, api on :${API_PORT}`));
