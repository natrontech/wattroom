// Leaving mid-ride (#4600). The web app refuses an unload while a ride runs
// or has not saved — in a browser the browser asks "Leave site?". Electron
// asks nothing: a refused unload is a quit, an update restart or a reload
// that silently does nothing. So the shell asks here, with the ride's own
// words, and the web app turns its guard on only in a shell that says it
// will (preload's `asksBeforeLeaving`), so an older shell keeps quitting.
const { dialog } = require('electron');

const STAY = 0;
const LEAVE = 1;

/**
 * @param win the main window
 * @param onStay called when the rider keeps the window: whatever was
 *   leaving (an update restart) stands down instead of forcing its way out.
 */
function attach(win, { onStay }) {
	win.webContents.on('will-prevent-unload', (event) => {
		const choice = dialog.showMessageBoxSync(win, {
			type: 'question',
			buttons: ['Stay', 'Leave'],
			defaultId: STAY,
			cancelId: STAY,
			message: 'Leave your ride?',
			detail:
				'A ride is running or not saved yet. If you leave, what you rode stays on this computer and saves the next time WattRoom can reach the server.',
		});
		// preventDefault here lets the unload through: the page's refusal is
		// what is being prevented.
		if (choice === LEAVE) event.preventDefault();
		else onStay();
	});
}

module.exports = { attach, STAY, LEAVE };
