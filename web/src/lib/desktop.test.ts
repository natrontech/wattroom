import { describe, expect, it } from 'vitest';
import {
	detectOS,
	formatBytes,
	installerOS,
	isNewer,
	parseRelease,
} from './desktop';

// The shape GitHub's releases/latest returns for what desktop-release.yml
// publishes: the installers, and the blockmaps and update manifests
// electron-builder leaves beside them.
const RELEASE = {
	tag_name: 'desktop-v0.2.0',
	html_url:
		'https://github.com/natrontech/wattroom-releases/releases/tag/desktop-v0.2.0',
	assets: [
		{
			name: 'WattRoom-0.2.0-mac-arm64.dmg',
			browser_download_url: 'https://x/WattRoom-0.2.0-mac-arm64.dmg',
			size: 128377524,
		},
		{
			name: 'WattRoom-0.2.0-mac-arm64.dmg.blockmap',
			browser_download_url: 'https://x/WattRoom-0.2.0-mac-arm64.dmg.blockmap',
			size: 136180,
		},
		{
			name: 'latest-mac.yml',
			browser_download_url: 'https://x/latest-mac.yml',
			size: 353,
		},
		{
			name: 'WattRoom-0.2.0-win-x64.exe',
			browser_download_url: 'https://x/WattRoom-0.2.0-win-x64.exe',
			size: 90000000,
		},
		{
			name: 'WattRoom-0.2.0-linux-x64.AppImage',
			browser_download_url: 'https://x/WattRoom-0.2.0-linux-x64.AppImage',
			size: 110000000,
		},
		{
			name: 'wattroom-desktop_0.2.0_amd64.deb',
			browser_download_url: 'https://x/wattroom-desktop_0.2.0_amd64.deb',
			size: 80000000,
		},
	],
};

describe('detectOS', () => {
	it.each([
		[
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/128',
			'mac',
		],
		[
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128',
			'windows',
		],
		['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128', 'linux'],
		[
			'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/128',
			'other',
		],
		[
			'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1',
			'phone',
		],
		['Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/128 Mobile', 'phone'],
		['curl/8.4.0', 'other'],
	])('%s → %s', (ua, os) => {
		expect(detectOS(ua)).toBe(os);
	});
});

describe('installerOS', () => {
	it('keys on the extension, not the name', () => {
		expect(installerOS('anything.dmg')).toBe('mac');
		expect(installerOS('WattRoom Setup 0.1.0.exe')).toBe('windows');
		expect(installerOS('a.AppImage')).toBe('linux');
		expect(installerOS('a_amd64.deb')).toBe('linux');
	});
	it('ignores what electron-builder leaves beside the installers', () => {
		expect(installerOS('WattRoom-0.2.0-mac-arm64.dmg.blockmap')).toBeNull();
		expect(installerOS('latest-mac.yml')).toBeNull();
	});
});

describe('parseRelease', () => {
	it('keeps the installers and drops the rest', () => {
		const r = parseRelease(RELEASE);
		expect(r?.version).toBe('0.2.0');
		expect(r?.page).toBe(RELEASE.html_url);
		expect(r?.installers.map((i) => [i.os, i.name])).toEqual([
			['mac', 'WattRoom-0.2.0-mac-arm64.dmg'],
			['windows', 'WattRoom-0.2.0-win-x64.exe'],
			['linux', 'WattRoom-0.2.0-linux-x64.AppImage'],
			['linux', 'wattroom-desktop_0.2.0_amd64.deb'],
		]);
		expect(r?.installers[0].bytes).toBe(128377524);
	});
	it('refuses anything that is not a desktop release', () => {
		expect(parseRelease(null)).toBeNull();
		expect(parseRelease({})).toBeNull();
		expect(parseRelease({ tag_name: '2026.09.5', assets: [] })).toBeNull();
		expect(parseRelease({ message: 'Not Found' })).toBeNull();
	});
	it('survives a release with no assets yet', () => {
		expect(parseRelease({ tag_name: 'desktop-v0.3.0' })).toEqual({
			version: '0.3.0',
			installers: [],
			page: 'https://github.com/natrontech/wattroom-releases/releases',
		});
	});
});

describe('isNewer', () => {
	it('compares numbers, not strings', () => {
		expect(isNewer('0.2.0', '0.1.9')).toBe(true);
		expect(isNewer('0.10.0', '0.9.0')).toBe(true);
		expect(isNewer('1.0', '0.9.9')).toBe(true);
	});
	it('is quiet on the same version, an older one, or one it cannot read', () => {
		expect(isNewer('0.1.0', '0.1.0')).toBe(false);
		expect(isNewer('0.1.0', '0.2.0')).toBe(false);
		expect(isNewer('0.2.0-beta.1', '0.1.0')).toBe(false);
		expect(isNewer('0.2.0', '0.0.0')).toBe(true);
		expect(isNewer('0.2.0', 'dev')).toBe(false);
	});
});

describe('isNewer with CalVer', () => {
	it('counts the way the server and the shell both do', () => {
		expect(isNewer('2026.09.2', '2026.09.1')).toBe(true);
		expect(isNewer('2026.09.10', '2026.09.9')).toBe(true);
		expect(isNewer('2026.10.1', '2026.09.46')).toBe(true);
		expect(isNewer('2026.09.1', '0.1.0')).toBe(true);
		// electron-builder writes the unpadded form into the app bundle; it is
		// the same version, not a newer one.
		expect(isNewer('2026.09.1', '2026.9.1')).toBe(false);
	});
});

describe('formatBytes', () => {
	it('rounds to whole megabytes and says nothing for an unknown size', () => {
		expect(formatBytes(128377524)).toBe('122 MB');
		expect(formatBytes(0)).toBe('');
	});
});
