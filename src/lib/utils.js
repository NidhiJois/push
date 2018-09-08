const vscode = require('vscode');
const tmp = require('tmp');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const constants = require('./constants');
const PushError = require('./PushError');
const i18n = require('../lang/i18n');

const utils = {
	_timeouts: {},
	_sb: null,
	_debug: fs.existsSync(path.dirname(path.dirname(__dirname)) + path.sep + '.debug'),

	/**
	 * Show an informational message using the VS Code interface
	 * @param {string} message - Message to display.
	 */
	showMessage(message) {
		utils.displayErrorOrString('showInformationMessage', message);
	},

	/**
	 * @description
	 * Show a localised informational message using the VS Code interface.
	 * Recieves the same arguments as i18n#t
	 * @see i18n#t
	 */
	showLocalisedMessage() {
		utils.showMessage(i18n.t.apply(i18n, [...arguments]));
	},

	/**
	 * Show an error message using the VS Code interface
	 * @param {string} message - Message to display.
	 */
	showError(message) {
		utils.displayErrorOrString('showErrorMessage', message);
	},

	/**
	 * Show a warning message using the VS Code interface
	 * @param {string} message - Message to display.
	 */
	showWarning(message) {
		utils.displayErrorOrString('showWarningMessage', message);
	},

	/**
	 * @description
	 * Show a localised warning message using the VS Code interface.
	 * Recieves the same arguments as i18n#t
	 * @see i18n#t
	 */
	showLocalisedWarning() {
		utils.showWarning(i18n.t.apply(i18n, [...arguments]));
	},

	/**
	 * Show a status message, optionally removing it after x seconds.
	 * @param {string} message - Message to show
	 * @param {number} [removeAfter=0] - How many seconds to wait before removing the
	 * message. Leave at 0 for a permanent message.
	 * @param {string} [color='green'] - Colour of the message.
	 * @returns vscode.StatusBarItem
	 */
	showStatusMessage(message, removeAfter = 0, color = null) {
		this.hideStatusMessage();

		if (!color) {
			color = new vscode.ThemeColor(config.get('statusMessageColor'));
		}

		this._sb = new vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.left,
			1
		);

		this._sb.text = message;
		this._sb.color = color;
		this._sb.show();

		if (removeAfter !== 0) {
			if (this._timeouts.sb) {
				clearTimeout(this._timeouts.sb);
			}

			this._timeouts.sb = setTimeout(() => {
				this.hideStatusMessage();
				this._timeouts.sb = null;
			}, (removeAfter * 1000));
		}

		return this._sb;
	},

	/**
	 * Hides any currently active status message.
	 */
	hideStatusMessage() {
		if (this._sb) {
			this._sb.dispose();
		}
	},

	/**
	 * Display an Error object or string using the VS code interface.
	 * @param {string} method - Method to use (one of `showXXXMessage` methods).
	 * @param {error|string} data - Data to display.
	 */
	displayErrorOrString(method, data) {
		if (data instanceof Error) {
			vscode.window[method](
				`Push: ${data.message}`
			);
		} else {
			vscode.window[method](
				`Push: ${data}`
			);
		}
	},

	showFileCollisionPicker(
		name,
		callback,
		queueLength = 0,
		placeHolder
	) {
		let options = [
			utils.collisionOpts.skip,
			utils.collisionOpts.rename,
			utils.collisionOpts.stop,
			utils.collisionOpts.overwrite,
		];

		placeHolder = placeHolder || i18n.t('filename_exists', name);

		if (queueLength > 1) {
			// Add "all" options if there's more than one item in the current queue
			options = options.concat([
				utils.collisionOptsAll.skip,
				utils.collisionOptsAll.rename,
				utils.collisionOptsAll.overwrite,
			]);
		}

		return new Promise((resolve) => {
			vscode.window.showQuickPick(
				options,
				{
					placeHolder,
					onDidSelectItem: callback
				}
			).then((option) => {
				resolve({ option, type: 'normal' });
			});
		});
	},

	showMismatchCollisionPicker(name, callback) {
		let options = [
				utils.collisionOpts.skip,
				utils.collisionOpts.rename,
				utils.collisionOpts.stop
			],
			placeHolder = i18n.t('filename_exists_mismatch', name);

		return new Promise((resolve) => {
			vscode.window.showQuickPick(
				options,
				{
					placeHolder,
					onDidSelectItem: callback
				}
			).then((option) => {
				resolve({ option, type: 'mismatch_type' });
			})
		});
	},

	trimSeparators: function(pathname, separator = '/') {
		const re = new RegExp(`^\${separator}+|\${separator}+$`, 'g');
		return pathname.trim(re, '');
	},

	/**
	 * Adds an OS-specific trailing separator to a path (unless the path
	 * consists solely of a separator).
	 */
	addTrailingSeperator(pathname, separator = '/') {
		if (!pathname.endsWith(separator)) {
			return pathname + separator;
		}

		return pathname;
	},

	/**
	 * Adds an OS-specific leading separator to a path (unless the path
	 * consists solely of a separator).
	 */
	addLeadingSeperator(pathname, separator = '/') {
		if (!pathname.startsWith(separator)) {
			return pathname + pathname;
		}

		return pathname;
	},

	/**
	 * Writes to a file from stream data.
	 * @param {stream} read - Readable Stream stream object.
	 * @param {string} filename - Absolute filename to write to.
	 * @param {boolean} useTmpFile - Whether to use a temporary file or write
	 * directly to the target file.
	 * @returns {Promise} Resolving on success, rejecting on failure
	 */
	writeFileFromStream(read, writeFilename, readFilename = '', useTmpFile = true) {
		return new Promise((resolve, reject) => {
			let writeFile = writeFilename,
				streamError, write;

			if (useTmpFile) {
				writeFile = this.getTmpFile(false);
			}

			write = fs.createWriteStream(writeFile);

			function cleanUp(error) {
				streamError = error;

				read.destroy();
				write.end();
			}

			// Set up write stream
			write.on('error', (error) => {
				cleanUp(error);

				reject(i18n.t(
					'stream_write',
					writeFile,
					(error && error.message)
				));
			});

			write.on('finish', () => {
				// Writing has finished (and thusly so has reading)
				let tmpRead;

				if (streamError) {
					return;
				}

				if (!useTmpFile) {
					return resolve();
				}

				tmpRead = fs.createReadStream(writeFile);

				// Copy file from temporary file to the required location
				this.writeFileFromStream(tmpRead, writeFilename, readFilename, false)
					.then(resolve, reject);
			});

			// Set up read stream
			read.on('error', (error) => {
				cleanUp(error);

				reject(i18n.t(
					'stream_read',
					(readFilename != '') ? readFilename : null,
					(error && error.message)
				));
			});

			// Begin the stream transfer
			read.pipe(write);
		});
	},

	/**
	 * Create a temporary file and return its filename.
	 * @param {boolean} [getUri=true] - Whether to return a URI or a string.
	 * @return {string} Filename created.
	 */
	getTmpFile(getUri = true) {
		let tmpobj = tmp.fileSync({
			prefix: constants.TMP_FILE_PREFIX
		});

		if (getUri) {
			return vscode.Uri.file(tmpobj.name);
		}

		return tmpobj.name;
	},

	trace(id) {
		if (this._debug) {
			console.log(
				(new Date).toLocaleTimeString() +
				`[${id}] - "${[...arguments].slice(1).join(', ')}"`
			);
		}
	},

	/**
	 * @param {string} fnName - Identifiable name of the Class#function calling this method.
	 * @param {*} args - The arguments as provided to the function.
	 * @param {array} asserts - Array of objects to compare to the arguments.
	 * @description
	 * Asserts that a function's arguments are of a specific type. Typescript on
	 * a budget :D Supply an arguments object as the second argument, and an array
	 * of Objects, Classes or strings as the third. The nth element in the third array
	 * will be used to compare to the second. In the case that a string is supplied,
	 * it will be passed to the `typeof` operator. Use `null` to ignore that index
	 * of argument.
	 * @example
	 * utils.assertFnArgs('File#put', arguments, [vscode.Uri, 'string']);
	 * // Assert File#put has two args of type: vscode.Uri and typeof 'string'.
	 * @returns {undefined} Returns nothing, but throws on assertion errors.
	 */
	assertFnArgs(fnName, args, asserts) {
		asserts.forEach((assertable, index) => {
			if (
				(args.length > index && typeof args[index] !== 'undefined') && (
					(typeof assertable === 'string' && (typeof args[index] !== assertable)) ||
					(typeof assertable !== 'string' && (
						assertable !== null && !(args[index] instanceof assertable)
					))
				)
			) {
				debugger;
				throw new Error(`${fnName}: Argument ${index} type mismatch.`);
			}
		});
	}
};

utils.collisionOpts = {
	skip: i18n.o({ label: 'skip', detail: 'skip_uploading_default' }),
	stop: i18n.o({ label: 'stop', detail: 'stop_transfer_empty_queue' }),
	overwrite: i18n.o({ label: 'overwrite', detail: 'replace_target_with_source' }),
	rename: i18n.o({ label: 'rename', detail: 'keep_both_files_by_rename' })
};

utils.collisionOptsAll = {
	skip: Object.assign(i18n.o({
		label: 'skip_all',
		detail: 'skip_uploading_all_existing'
	}), {
		baseOption: utils.collisionOpts.skip
	}),
	overwrite: Object.assign(i18n.o({
		label: 'overwrite_all',
		detail: 'replace_all_existing'
	}), {
		baseOption: utils.collisionOpts.overwrite
	}),
	rename: Object.assign(i18n.o({
		label: 'rename_all',
		detail: 'keep_all_existing_by_renaming_uploaded'
	}), {
		baseOption: utils.collisionOpts.rename
	})
};

utils.errors = {
	stop: new PushError(i18n.t('transfer_cancelled'))
};

module.exports = utils;
