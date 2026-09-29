// The one native chooser the shell draws: a message box of buttons, for the
// screen picker and for a web app too old to draw the Bluetooth one.

const { dialog } = require('electron');

/**
 * A chooser with no UI of its own. `dialog.showMessageBox` is native, needs no
 * renderer, and cannot drift from the app's theme because it has none.
 *
 * ponytail: caps at eight entries plus Cancel — past that a message box is the
 * wrong control. The Bluetooth chooser outgrew it and now draws in the app
 * (#1716); the screen picker still fits, and its checkbox has no counterpart
 * in a renderer-side one.
 *
 * @returns the chosen value (null if cancelled), and the checkbox if asked.
 */
async function chooseFrom(win, title, options, checkboxLabel = null) {
	const shown = options.slice(0, 8);
	const { response, checkboxChecked } = await dialog.showMessageBox(win, {
		type: 'question',
		title,
		message: title,
		buttons: [...shown.map((o) => o.label), 'Cancel'],
		cancelId: shown.length,
		defaultId: 0,
		...(checkboxLabel ? { checkboxLabel, checkboxChecked: false } : {}),
	});
	return {
		value: shown[response]?.value ?? null,
		checked: checkboxChecked === true,
	};
}

module.exports = { chooseFrom };
