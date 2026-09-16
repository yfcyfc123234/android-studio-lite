import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as cp from 'child_process';
import { promisify } from 'util';
import { Manager } from '../core';
import { listOnlineAdbDevices, formatAdbDeviceLabel } from '../utils/adbDevices';

const execFileAsync = promisify(cp.execFile);

export const WORKSPACE_SELECTED_DEVICE_SERIAL = 'android-studio-lite.selectedDeviceSerial';

export type ScreenshotSaveMode = 'file' | 'clipboard' | 'ask';

/**
 * Device screenshot capture (adb screencap), similar to Android Studio:
 * save to a folder and/or copy the PNG to the system clipboard.
 */
export class ScreenshotService {
	constructor(
		private readonly manager: Manager,
		private readonly context: vscode.ExtensionContext,
	) {}

	async takeScreenshot(preferredSerial?: string): Promise<void> {
		const adbPath = this.getAdbPath();
		if (!adbPath) {
			vscode.window.showErrorMessage('ADB not found. Configure android-studio-lite.sdkPath / ANDROID_HOME.');
			return;
		}

		const serial = preferredSerial || (await this.resolveDeviceSerial(adbPath));
		if (!serial) {
			return;
		}

		const mode = await this.resolveSaveMode();
		if (!mode) {
			return;
		}

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Capturing screenshot (${serial})…`,
				cancellable: false,
			},
			async () => {
				const png = await this.capturePng(adbPath, serial);
				const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
				const fileName = `Screenshot_${stamp}.png`;

				if (mode === 'file') {
					const savedPath = await this.saveToFile(png, fileName);
					if (!savedPath) {
						return;
					}
					await this.context.workspaceState.update(WORKSPACE_SELECTED_DEVICE_SERIAL, serial);
					const open = await vscode.window.showInformationMessage(
						`Screenshot saved: ${savedPath}`,
						'Reveal',
						'Copy Path',
					);
					if (open === 'Reveal') {
						vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(savedPath));
					} else if (open === 'Copy Path') {
						await vscode.env.clipboard.writeText(savedPath);
					}
					return;
				}

				const tempPath = path.join(os.tmpdir(), fileName);
				fs.writeFileSync(tempPath, png);
				try {
					await this.copyImageToClipboard(tempPath);
					await this.context.workspaceState.update(WORKSPACE_SELECTED_DEVICE_SERIAL, serial);
					vscode.window.showInformationMessage('Screenshot copied to clipboard.');
				} finally {
					try {
						fs.unlinkSync(tempPath);
					} catch {
						/* ignore */
					}
				}
			},
		);
	}

	private async resolveSaveMode(): Promise<'file' | 'clipboard' | undefined> {
		const cfg = vscode.workspace.getConfiguration('android-studio-lite');
		const configured = (cfg.get<ScreenshotSaveMode>('screenshot.saveMode', 'ask') || 'ask') as ScreenshotSaveMode;

		if (configured === 'file' || configured === 'clipboard') {
			return configured;
		}

		const pick = await vscode.window.showQuickPick(
			[
				{ label: 'Save to file', description: 'Write PNG under the configured save path', mode: 'file' as const },
				{ label: 'Copy to clipboard', description: 'Keep in memory for paste (Ctrl+V)', mode: 'clipboard' as const },
			],
			{ placeHolder: 'Screenshot action (like Android Studio)' },
		);
		return pick?.mode;
	}

	private async resolveDeviceSerial(adbPath: string): Promise<string | undefined> {
		const saved = this.context.workspaceState.get<string>(WORKSPACE_SELECTED_DEVICE_SERIAL);
		const devices = await listOnlineAdbDevices(adbPath);
		if (devices.length === 0) {
			vscode.window.showErrorMessage('No online Android device/emulator. Connect a device or start an AVD.');
			return undefined;
		}

		if (saved && devices.some(d => d.serial === saved)) {
			return saved;
		}

		if (devices.length === 1) {
			return devices[0].serial;
		}

		const pick = await vscode.window.showQuickPick(
			devices.map(d => ({
				label: formatAdbDeviceLabel(d),
				description: d.serial,
				serial: d.serial,
			})),
			{ placeHolder: 'Select device for screenshot' },
		);
		return pick?.serial;
	}

	private capturePng(adbPath: string, serial: string): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			const args = ['-s', serial, 'exec-out', 'screencap', '-p'];
			const child = cp.spawn(adbPath, args, { windowsHide: true });
			const chunks: Buffer[] = [];
			const errChunks: Buffer[] = [];

			child.stdout.on('data', (d: Buffer) => chunks.push(d));
			child.stderr.on('data', (d: Buffer) => errChunks.push(d));
			child.on('error', reject);
			child.on('close', (code) => {
				const buf = Buffer.concat(chunks);
				if (code !== 0 || buf.length < 8) {
					reject(new Error(Buffer.concat(errChunks).toString('utf8') || `screencap failed (code ${code})`));
					return;
				}
				// PNG magic
				if (buf[0] !== 0x89 || buf[1] !== 0x50) {
					reject(new Error('screencap did not return a PNG. Is the device unlocked / screen on?'));
					return;
				}
				resolve(buf);
			});
		});
	}

	private async saveToFile(png: Buffer, fileName: string): Promise<string | undefined> {
		const dir = this.resolveSaveDirectory();
		try {
			fs.mkdirSync(dir, { recursive: true });
		} catch (e: any) {
			vscode.window.showErrorMessage(`Cannot create screenshot folder: ${dir}\n${e?.message || e}`);
			return undefined;
		}
		const full = path.join(dir, fileName);
		fs.writeFileSync(full, png);
		return full;
	}

	private resolveSaveDirectory(): string {
		const cfg = vscode.workspace.getConfiguration('android-studio-lite');
		const configured = (cfg.get<string>('screenshot.savePath', '') || '').trim();
		if (configured) {
			return configured.replace(/^~(?=$|[/\\])/, os.homedir());
		}
		const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (ws) {
			return path.join(ws, 'screenshots');
		}
		return path.join(os.homedir(), 'Pictures', 'AndroidScreenshots');
	}

	private async copyImageToClipboard(imagePath: string): Promise<void> {
		const abs = path.resolve(imagePath);
		if (process.platform === 'win32') {
			const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile(${JSON.stringify(abs)})
try {
  [System.Windows.Forms.Clipboard]::SetImage($img)
} finally {
  $img.Dispose()
}
`;
			await execFileAsync('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], {
				windowsHide: true,
				timeout: 20000,
			});
			return;
		}

		if (process.platform === 'darwin') {
			const script = `set the clipboard to (read (POSIX file ${JSON.stringify(abs)}) as «class PNGf»)`;
			await execFileAsync('osascript', ['-e', script], { timeout: 20000 });
			return;
		}

		// Linux: prefer xclip, then wl-copy
		try {
			await execFileAsync('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-i', abs], {
				timeout: 20000,
			});
		} catch {
			await execFileAsync('wl-copy', ['-t', 'image/png'], {
				timeout: 20000,
				input: fs.readFileSync(abs),
			} as any);
		}
	}

	private getAdbPath(): string | null {
		const config = this.manager.getConfig();
		const custom = vscode.workspace.getConfiguration('android-studio-lite').get<string>('adbPath', '');
		if (custom && fs.existsSync(custom)) {
			return custom;
		}
		const sdkPath = config.sdkPath;
		if (!sdkPath) {
			return null;
		}
		const adb = path.join(sdkPath, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
		return fs.existsSync(adb) ? adb : null;
	}
}
