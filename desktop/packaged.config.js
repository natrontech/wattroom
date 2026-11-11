// The packaged shell over CDP (#1314). Its own config, apart from the smoke's:
// this one needs a built app and a running server, which the smoke never has,
// so it is never part of `make desktop-smoke` or the smoke job.
module.exports = {
	testDir: '.',
	testMatch: ['packaged.spec.js'],
	workers: 1,
	timeout: 5 * 60 * 1000,
	expect: { timeout: 10_000 },
	reporter: process.env.CI ? [['github'], ['list']] : 'list',
	use: { trace: 'off' },
};
