// Import the module and reference it with the alias vscode in your code below
// The module 'vscode' contains the VS Code extensibility API
const vscode = require('vscode');
const Push = require('./src/Push');

let push;

exports.activate = (context) => {
	push = new Push();

	context.subscriptions.concat([
		vscode.commands.registerCommand('push.upload', push.upload, push),
		vscode.commands.registerCommand('push.download', push.download, push),
		vscode.commands.registerCommand('push.uploadFolder', push.upload, push),
		vscode.commands.registerCommand('push.downloadFolder', push.download, push),
		vscode.commands.registerCommand('push.diff', push.diff, push),
		vscode.commands.registerCommand('push.uploadQueuedItems', push.execUploadQueue, push),
		vscode.commands.registerCommand('push.clearUploadQueue', push.clearUploadQueue, push),
		vscode.commands.registerCommand('push.cancelQueues', push.cancelQueues, push),
		vscode.commands.registerCommand('push.addWatchFile', push.addWatch, push),
		vscode.commands.registerCommand('push.removeWatchFile', push.removeWatch, push),
		vscode.commands.registerCommand('push.addWatchFolder', push.addWatch, push),
		vscode.commands.registerCommand('push.removeWatchFolder', push.removeWatch, push),
		vscode.commands.registerCommand('push.listWatchers', push.listWatchers, push),
		vscode.commands.registerCommand('push.startWatch', push.startWatch, push),
		vscode.commands.registerCommand('push.stopWatch', push.stopWatch, push),
		vscode.commands.registerCommand('push.clearWatchers', push.clearWatchers, push),
		vscode.commands.registerCommand('push.editServiceConfig', push.editServiceConfig, push),
		vscode.commands.registerCommand('push.importConfig', push.importConfig, push)
	]);
};

// this method is called when your extension is deactivated
// function deactivate() {
// }
// exports.deactivate = deactivate;