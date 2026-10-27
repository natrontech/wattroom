/**
 * The world's four cameras, in the order keys 1-4 name them (#3216), and the
 * order a remote's or a controller's Camera steps through (#4253). Three-free,
 * so the keys and the phone remote can name them.
 */
export const CAMERA_PRESETS = ['chase', 'heli', 'side', 'steady'] as const;
export type CameraPreset = (typeof CAMERA_PRESETS)[number];

/** Each camera in a rider's words, as the Controllers page names them. */
export const CAMERA_NAMES: Record<CameraPreset, string> = {
	chase: 'Chase',
	heli: 'Overhead',
	side: 'Side',
	steady: 'Steady',
};
