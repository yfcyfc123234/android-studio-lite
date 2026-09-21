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
				let png: Buffer;
				try {
					png = await this.capturePng(adbPath, serial);
				} catch (e: unknown) {
					const message = e instanceof Error ? e.message : String(e);
					this.manager.output.appendTime();
					const lines = e instanceof ScreencapError ? e.logLines : [`[screenshot] ${message}`];
					for (const line of lines) {
						this.manager.output.append(line, 'error');
					}
					this.manager.output.show();
					vscode.window.showErrorMessage(message);
					return;
				}
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

	private async capturePng(adbPath: string, serial: string): Promise<Buffer> {
		// Help text names the display that matches the current fold state.
		// Omitting -d still returns that PNG, but foldables prefix a warning on stdout.
		const displayId = await this.readDefaultDisplayId(adbPath, serial);
		const args = ['-s', serial, 'exec-out', 'screencap', '-p'];
		if (displayId) {
			args.push('-d', displayId);
		}
		const { code, stdout, stderr } = await this.execOut(adbPath, args);
		const extracted = extractPngPayload(stdout);
		const buf = extracted ? extracted.png : stdout;
		if (displayId) {
			this.manager.output.append(`[screenshot] displayId=${displayId} serial=${serial}`);
		}
		if (extracted?.prefix) {
			this.manager.output.append(
				`[screenshot] ignored stdout prefix serial=${serial}: ${oneLine(extracted.prefix, 240)}`,
			);
		}
		const failure = explainScreencapFailure(serial, code, buf, stderr);
		if (failure) {
			throw new ScreencapError(failure.summary, failure.logLines);
		}
		this.manager.output.append(`[screenshot] ok serial=${serial} pngBytes=${buf.length}`);
		return buf;
	}

	/** `screencap -h` default id. Changes when a foldable opens or closes. */
	private readDefaultDisplayId(adbPath: string, serial: string): Promise<string | undefined> {
		return new Promise((resolve) => {
			const child = cp.spawn(adbPath, ['-s', serial, 'shell', 'screencap', '-h'], { windowsHide: true });
			const chunks: Buffer[] = [];
			child.stdout.on('data', (d: Buffer) => chunks.push(d));
			child.stderr.on('data', (d: Buffer) => chunks.push(d));
			child.on('error', () => resolve(undefined));
			child.on('close', () => {
				const text = Buffer.concat(chunks).toString('utf8');
				const match = text.match(/default(?:s\s+to|:)\s*(\d{8,})/i);
				resolve(match?.[1]);
			});
		});
	}

	private execOut(adbPath: string, args: string[]): Promise<{ code: number | null; stdout: Buffer; stderr: Buffer }> {
		return new Promise((resolve, reject) => {
			const child = cp.spawn(adbPath, args, { windowsHide: true });
			const chunks: Buffer[] = [];
			const errChunks: Buffer[] = [];
			child.stdout.on('data', (d: Buffer) => chunks.push(d));
			child.stderr.on('data', (d: Buffer) => errChunks.push(d));
			child.on('error', reject);
			child.on('close', (code) => {
				resolve({
					code,
					stdout: Buffer.concat(chunks),
					stderr: Buffer.concat(errChunks),
				});
			});
		});
	}

	private async saveToFile(png: Buffer, fileName: string): Promise<string | undefined> {
		const dir = this.resolveSaveDirectory();
		try {
			fs.mkdirSync(dir, { recursive: true });
		} catch (e: unknown) {
			const detail = e instanceof Error ? e.message : String(e);
			vscode.window.showErrorMessage(`Cannot create screenshot folder: ${dir}\n${detail}`);
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

/** Failure detail for the output channel; summary is the one-line toast. */
class ScreencapError extends Error {
	constructor(message: string, readonly logLines: string[]) {
		super(message);
		this.name = 'ScreencapError';
	}
}

const PIXEL_FORMAT_NAMES: Record<number, string> = {
	1: 'RGBA_8888',
	2: 'RGBX_8888',
	3: 'RGB_888',
	4: 'RGB_565',
	5: 'BGRA_8888',
};

function explainScreencapFailure(
	serial: string,
	code: number | null,
	stdout: Buffer,
	stderr: Buffer,
): { summary: string; logLines: string[] } | undefined {
	if (code === 0 && isPng(stdout)) {
		return undefined;
	}

	const kind = describeScreencapBytes(stdout);
	const hex = hexPrefix(stdout, 32);
	const stderrText = oneLine(stderr.toString('utf8'), 240);
	const stdoutText = looksLikeText(stdout) ? oneLine(stdout.toString('utf8'), 240) : '';
	const summary = `Screenshot failed (${serial}): ${kind}`;
	const logLines = [
		`[screenshot] serial=${serial} exit=${code ?? 'null'} stdoutBytes=${stdout.length} stderrBytes=${stderr.length}`,
		`[screenshot] ${kind}`,
		`[screenshot] stdout[0:32]=${hex || '(empty)'}`,
	];
	if (stdoutText) {
		logLines.push(`[screenshot] stdout text: ${stdoutText}`);
	}
	if (stderrText) {
		logLines.push(`[screenshot] stderr: ${stderrText}`);
	}
	return { summary, logLines };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buf: Buffer): boolean {
	return buf.length >= PNG_SIGNATURE.length && buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

/** PNG may follow a short text warning on stdout. Returns undefined when no PNG signature is present. */
function extractPngPayload(buf: Buffer): { png: Buffer; prefix: string } | undefined {
	const at = buf.indexOf(PNG_SIGNATURE);
	if (at < 0 || at > 8192) {
		return undefined;
	}
	if (at === 0) {
		return { png: buf, prefix: '' };
	}
	const head = buf.subarray(0, at);
	if (!looksLikeText(head)) {
		return undefined;
	}
	return { png: buf.subarray(at), prefix: head.toString('utf8') };
}

function describeScreencapBytes(buf: Buffer): string {
	if (buf.length < 8) {
		return `output too short (${buf.length} bytes), not a PNG`;
	}
	if (isPng(buf)) {
		return 'PNG bytes received but screencap exit code was not 0';
	}
	if (buf[0] === 0xff && buf[1] === 0xd8) {
		return 'JPEG (FF D8). This command asks for PNG via screencap -p';
	}
	if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
		return 'WebP, not PNG';
	}
	const width = buf.readUInt32LE(0);
	const height = buf.readUInt32LE(4);
	const format = buf.readUInt32LE(8);
	if (width >= 16 && width <= 8192 && height >= 16 && height <= 8192 && format >= 1 && format <= 64) {
		const name = PIXEL_FORMAT_NAMES[format] || `format=${format}`;
		return `raw framebuffer ${width}x${height} ${name}; screencap -p was not honored`;
	}
	if (looksLikeText(buf.subarray(0, Math.min(buf.length, 64)))) {
		return `text, not an image: ${oneLine(buf.toString('utf8'), 120)}`;
	}
	return 'unrecognized bytes (not PNG, JPEG, WebP, or raw framebuffer)';
}

function looksLikeText(buf: Buffer): boolean {
	if (buf.length === 0) {
		return false;
	}
	let printable = 0;
	const n = Math.min(buf.length, 64);
	for (let i = 0; i < n; i++) {
		const b = buf[i];
		if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e)) {
			printable++;
		}
	}
	return printable / n >= 0.85;
}

function oneLine(text: string, max: number): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

function hexPrefix(buf: Buffer, maxBytes: number): string {
	return buf.subarray(0, maxBytes).toString('hex').replace(/(.{2})/g, '$1 ').trim();
}
