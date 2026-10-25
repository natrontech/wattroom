import { execFileSync } from 'node:child_process';

/**
 * A PNG written out as WebP at the site's quality, by cwebp or else
 * ImageMagick. `crop`: ImageMagick geometry (`WxH+X+Y`) taken first.
 */
export function toWebp(png, webp, { crop } = {}) {
	const tools = crop
		? [['magick', [png, '-crop', crop, '+repage', '-quality', '80', webp]]]
		: [
				['cwebp', ['-quiet', '-q', '80', '-m', '6', png, '-o', webp]],
				['magick', [png, '-quality', '80', webp]],
			];
	for (const [cmd, args] of tools) {
		try {
			execFileSync(cmd, args, { stdio: 'inherit' });
			return;
		} catch (err) {
			if (err.code !== 'ENOENT') throw err;
		}
	}
	throw new Error(
		'Neither cwebp nor ImageMagick is installed: `brew install webp`.',
	);
}
