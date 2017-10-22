const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const Glob = require('glob').Glob;

const ServiceBase = require('./Base');
const utils = require('../lib/utils');
const ExtendedStream = require('../lib/ExtendedStream');
const PathCache = require('../lib/PathCache');

const SRC_REMOTE = PathCache.sources.REMOTE;

class File extends ServiceBase {
	constructor(options) {
		super(options);

		this.mkDir = this.mkDir.bind(this);

		this.type = 'File';
		this.pathCache = new PathCache();
		this.writeStream = null;
		this.readStream = null;

		// Define File defaults
		this.serviceDefaults = {
			root: '/',
			timeZoneOffset: 0,
			testCollisionTimeDiffs: true,
			collisionUploadAction: null,
			collisionDownloadAction: null
		};

		// Define File validation rules
		this.serviceValidation = {
			root: true
		};
	}

	init(queueLength) {
		return super.init(queueLength)
			.then(() => {
				return this.pathCache.clear();
			});
	}

	/**
	 * Put a single file to the remote location.
	 * @param {uri} local - Local Uri or Readable stream instance.
	 * @param {uri} remote - Remote Uri.
	 */
	put(local, remote) {
		// Perform transfer from local to remote, setting root as defined by service
		return this.transfer(
			local,
			vscode.Uri.parse(remote),
			this.config.service.root,
			'>> ',
			this.config.service.collisionUploadAction
		);
	}

	/**
	 * Put a single file to the remote location.
	 * @param {uri} local - Local Uri.
	 * @param {uri} remote - Remote Uri.
	 */
	get(local, remote) {
		// Perform transfer from remote to local, setting root as base of service file
		return this.transfer(
			vscode.Uri.parse(remote),
			local,
			path.dirname(this.config.serviceFilename),
			'<< ',
			this.config.service.collisionDownloadAction
		);
	}

	/**
	 * Transfers a single file from location to another.
	 * @param {uri} src - Source Uri.
	 * @param {uri} dest - Destination Uri.
	 * @param {string} rootDir - Root directory. Used for validation.
	 */
	transfer(src, dest, rootDir, logPrefix = '', collisionAction) {
		let destPath = this.paths.getNormalPath(dest),
			destDir = path.dirname(destPath),
			destFilename = path.basename(destPath);

		this.setProgress(`${destFilename}...`);

		return this.mkDirRecursive(destDir, rootDir, this.mkDir)
			.then(() => this.getFileStats(dest, src))
			.then((stats) => super.checkCollision(
				stats.local,
				stats.remote,
				collisionAction
			))
			.then((result) => {
				// Figure out what to do based on the collision (if any)
				if (result === false) {
					// No collision, just keep going
					this.channel.appendLine(`${logPrefix}${destPath}`);
					return this.copy(src, destPath);
				} else {
					this.setCollisionOption(result);

					switch (result.option) {
						case utils.collisionOpts.stop:
							throw utils.errors.stop;

						case utils.collisionOpts.skip:
							return false;

						case utils.collisionOpts.overwrite:
							this.channel.appendLine(`${logPrefix}${destPath}`);
							return this.copy(src, destPath);

						case utils.collisionOpts.rename:
							return this.list(destDir)
								.then((dirContents) => {
									// Re-invoke transfer with new filename
									destPath = destDir + '/' + this.getNonCollidingName(
										destFilename,
										dirContents
									);

									return this.transfer(
										src,
										destPath,
										rootDir,
										logPrefix
									);
								});
					}

					return false;
				}
			})
			.then((result) => {
				this.setProgress(false);
				return result;
			})
			.catch((error) => {
				this.setProgress(false);
				throw error;
			});
	}

	/**
	 * Effectively stops the read and write streams by end() and destroy().
	 * @param {function} fnCallback - Optional callback function to call after stopping.
	 */
	stop(fnCallback) {
		// Stop read stream
		if (this.readStream) {
			this.readStream.destroy();
		}

		// Stop write stream
		if (this.writeStream) {
			this.writeStream.end();
			this.writeStream.destroy();
		}

		if (typeof fnCallback === 'function') {
			fnCallback();
		}
	}

	/**
	 * Recursively creates direcotories up to and including the basename of the given path.
	 * Will reject on an incompatible collision.
	 * @param {string} dest - Destination directory to create
	 */
	mkDir(dest) {
		return this.list(path.dirname(dest))
			.then(() => {
				let existing = this.pathCache.getFileByPath(SRC_REMOTE, dest);

				if (existing === null) {
					return new Promise((resolve, reject) => {
						fs.mkdir(dest, (error) => {
							if (error) {
								reject(error);
							}

							// Add dir to cache
							this.pathCache.addCachedFile(
								SRC_REMOTE,
								dest,
								((new Date()).getTime() / 1000),
								'd'
							);

							resolve();
						});
					});
				} else if (existing.type === 'f') {
					return Promise.reject(new Error(
						'Directory could not be created' +
						' (a file with the same name exists on the remote!)'
					));
				}
			});
	}

	/**
	 * Return a list of the remote directory.
	 * @param {string} dir - Remote directory to list
	 */
	list(dir) {
		if (this.pathCache.dirIsCached(SRC_REMOTE, dir)) {
			return Promise.resolve(this.pathCache.getDir(SRC_REMOTE, dir));
		} else {
			return new Promise((resolve, reject) => {
				fs.readdir(dir, (error, list) => {
					if (error) {
						return reject(error);
					}

					list.forEach((filename) => {
						let pathname = dir + '/' + filename,
							stats = fs.statSync(pathname);

						this.pathCache.addCachedFile(
							SRC_REMOTE,
							pathname,
							(stats.mtime.getTime() / 1000),
							(stats.isDirectory() ? 'd' : 'f')
						);
					});

					resolve(this.pathCache.getDir(SRC_REMOTE, dir));
				});
			});
		}
	}

	listRecursiveFiles(uri, ignoreGlobs) {
		return this.paths.getDirectoryContentsAsFiles(uri, ignoreGlobs);
	}

	/**
	 * Obtains local/remote stats for a file.
	 * @param {uri} remote - Remote Uri.
	 * @param {uri} local - Local Uri.
	 */
	getFileStats(remote, local) {
		const remotePath = this.paths.getNormalPath(remote),
			remoteDir = path.dirname(remotePath);

		return this.list(remoteDir)
			.then(() => {
				const remoteStat = this.pathCache.getFileByPath(
					SRC_REMOTE,
					remotePath
				);

				let localPath = this.paths.getNormalPath(local),
					localStat = fs.statSync(localPath);

				return {
					local: {
						name: path.basename(localPath),
						modified: (localStat.mtime.getTime() / 1000),
						type: (localStat.isDirectory() ? 'd' : 'f')
					},
					remote: remoteStat
				};
			});
	}

	/**
	 * Copies a file or stream from one location to another.
	 * @param {*} src - Either a source Uri or a readable stream.
	 * @param {string} dest - Destination filename.
	 */
	copy(src, dest) {
		return new Promise((resolve, reject) => {
			function fnError(error) {
				this.stop(() => reject(error));
			};

			// Create write stream & attach events
			this.writeStream = fs.createWriteStream(dest);
			this.writeStream.on('error', fnError.bind(this));
			this.writeStream.on('finish', resolve);

			if (src instanceof vscode.Uri || typeof src === 'string') {
				// Source is a VSCode Uri - create a read stream
				this.readStream = fs.createReadStream(this.paths.getNormalPath(src));
				this.readStream.on('error', fnError.bind(this));
				this.readStream.pipe(this.writeStream);
			} else if (src instanceof ExtendedStream) {
				// Source is already a stream - just pipe to the write stream
				this.readStream = src.read;
				this.readStream.on('error', fnError.bind(this));
				this.readStream.pipe(this.writeStream);
			} else {
				reject(new Error(
					'Source src argument is neither a readable stream or a filename.'
				));
			}
		});
	}
};

module.exports = File;