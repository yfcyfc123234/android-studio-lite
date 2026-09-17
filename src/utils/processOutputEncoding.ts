import * as cp from 'child_process';
import * as vscode from 'vscode';
import * as iconv from 'iconv-lite';

/**
 * Decode child-process stdout/stderr for VS Code / Cursor Output panels.
 *
 * Why: Node defaults to UTF-8, while Windows JVM/Gradle often emit the system
 * ANSI/OEM code page (e.g. CP936/GBK). See vscode-gradle#1480 and common
 * iconv + chcp patterns used by other tools.
 *
 * Resolution order for encoding (auto):
 * 1. android-studio-lite.processOutputEncoding (when not "auto")
 * 2. files.encoding (workspace/user) when it maps to a known codec
 * 3. java.import.gradle.jvmArguments / java.jdt.ls.vmargs encoding hints
 * 4. Windows console code page via `chcp` (OEMCP env override supported)
 * 5. utf8
 *
 * When forceUtf8ForJava is on and the resolved decode encoding is utf8,
 * Gradle spawns get JVM -Dfile/stdout/stderr.encoding=UTF-8 so Output stays consistent.
 */

const JVM_UTF8_FLAGS =
	'-Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8';

const FILES_ENCODING_MAP: Record<string, string> = {
	utf8: 'utf8',
	'utf-8': 'utf8',
	utf8bom: 'utf8',
	gbk: 'gbk',
	gb2312: 'gb2312',
	gb18030: 'gb18030',
	big5: 'big5',
	eucjp: 'euc-jp',
	euokr: 'euc-kr',
	shiftjis: 'shift_jis',
	windows1252: 'windows-1252',
	iso88591: 'iso-8859-1',
};

let cachedWindowsCp: string | undefined;

export function resetProcessOutputEncodingCache(): void {
	cachedWindowsCp = undefined;
}

export function resolveProcessOutputEncoding(): string {
	const ext = vscode.workspace.getConfiguration('android-studio-lite');
	const configured = String(ext.get<string>('processOutputEncoding') || 'auto').trim().toLowerCase();
	if (configured && configured !== 'auto' && configured !== 'system') {
		return normalizeCodecName(configured);
	}
	if (configured === 'system') {
		return detectWindowsConsoleEncoding() || 'utf8';
	}

	const filesEnc = String(vscode.workspace.getConfiguration('files').get<string>('encoding') || '')
		.trim()
		.toLowerCase();
	if (filesEnc && FILES_ENCODING_MAP[filesEnc]) {
		return FILES_ENCODING_MAP[filesEnc];
	}

	const fromJavaSettings = encodingHintFromJavaSettings();
	if (fromJavaSettings) {
		return fromJavaSettings;
	}

	if (process.platform === 'win32') {
		return detectWindowsConsoleEncoding() || 'utf8';
	}
	return 'utf8';
}

export function shouldForceUtf8ForJava(): boolean {
	const ext = vscode.workspace.getConfiguration('android-studio-lite');
	if (ext.get<boolean>('forceUtf8ForJava') === false) {
		return false;
	}
	// Only force when we will decode as UTF-8; otherwise JVM UTF-8 + GBK decode double-breaks.
	const enc = resolveProcessOutputEncoding();
	return enc === 'utf8' || enc === 'utf-8';
}

/** Merge JVM UTF-8 flags into env for Gradle/Java child processes. */
export function withJavaUtf8ProcessEnv(baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...(baseEnv || process.env) };
	if (!shouldForceUtf8ForJava()) {
		return env;
	}
	env.JAVA_TOOL_OPTIONS = appendJvmFlags(env.JAVA_TOOL_OPTIONS, JVM_UTF8_FLAGS);
	env.GRADLE_OPTS = appendJvmFlags(env.GRADLE_OPTS, JVM_UTF8_FLAGS);
	return env;
}

export function decodeProcessBuffer(data: Buffer | string, encoding = resolveProcessOutputEncoding()): string {
	const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
	if (buf.length === 0) {
		return '';
	}
	const codec = normalizeCodecName(encoding);
	if (codec === 'utf8' || codec === 'utf-8') {
		return buf.toString('utf8');
	}
	if (iconv.encodingExists(codec)) {
		return iconv.decode(buf, codec);
	}
	return buf.toString('utf8');
}

/**
 * Streaming decoder: holds trailing incomplete multi-byte sequences across chunks.
 */
export class StreamingProcessDecoder {
	private leftover = Buffer.alloc(0);
	private readonly encoding: string;
	private readonly holdBytes: number;

	constructor(encoding = resolveProcessOutputEncoding()) {
		this.encoding = normalizeCodecName(encoding);
		this.holdBytes = this.encoding === 'utf8' || this.encoding === 'utf-8' ? 3 : 2;
	}

	push(chunk: Buffer | string): string {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, 'binary');
		const data = Buffer.concat([this.leftover, buf]);
		if (data.length <= this.holdBytes) {
			this.leftover = data;
			return '';
		}
		const emitLen = data.length - this.holdBytes;
		const emit = data.subarray(0, emitLen);
		this.leftover = data.subarray(emitLen);
		return decodeProcessBuffer(emit, this.encoding);
	}

	end(): string {
		if (this.leftover.length === 0) {
			return '';
		}
		const text = decodeProcessBuffer(this.leftover, this.encoding);
		this.leftover = Buffer.alloc(0);
		return text;
	}
}

function encodingHintFromJavaSettings(): string | undefined {
	const java = vscode.workspace.getConfiguration('java');
	const blobs = [
		String(java.get<string>('import.gradle.jvmArguments') || ''),
		String(java.get<string>('jdt.ls.vmargs') || ''),
	].join(' ');
	if (!blobs.trim()) {
		return undefined;
	}
	if (/file\.encoding\s*=\s*COMPAT/i.test(blobs) || /stdout\.encoding\s*=\s*COMPAT/i.test(blobs)) {
		return detectWindowsConsoleEncoding() || undefined;
	}
	if (/file\.encoding\s*=\s*UTF-?8/i.test(blobs) || /stdout\.encoding\s*=\s*UTF-?8/i.test(blobs)) {
		return 'utf8';
	}
	if (/file\.encoding\s*=\s*GBK/i.test(blobs) || /file\.encoding\s*=\s*GB2312/i.test(blobs)) {
		return 'gbk';
	}
	return undefined;
}

function detectWindowsConsoleEncoding(): string | undefined {
	if (process.platform !== 'win32') {
		return undefined;
	}
	if (cachedWindowsCp) {
		return cachedWindowsCp;
	}
	const fromEnv = Number(process.env.OEMCP || process.env.ASL_OEMCP || '');
	if (Number.isFinite(fromEnv) && fromEnv > 0) {
		cachedWindowsCp = `cp${fromEnv}`;
		return cachedWindowsCp;
	}
	try {
		const out = cp.execFileSync('cmd.exe', ['/c', 'chcp'], {
			encoding: 'buffer',
			windowsHide: true,
			timeout: 3000,
		}) as Buffer;
		const text = out.toString('utf8');
		const match = text.match(/(\d{3,5})/);
		if (match) {
			const cpNum = match[1];
			cachedWindowsCp = cpNum === '65001' ? 'utf8' : `cp${cpNum}`;
			return cachedWindowsCp;
		}
	} catch {
		// ignore
	}
	cachedWindowsCp = 'cp936';
	return cachedWindowsCp;
}

function normalizeCodecName(name: string): string {
	const n = name.trim().toLowerCase().replace(/_/g, '-');
	if (n === 'utf-8' || n === 'utf8') {
		return 'utf8';
	}
	if (n === 'cp936' || n === 'ms936') {
		return 'gbk';
	}
	if (n === 'cp932' || n === 'ms932') {
		return 'shift_jis';
	}
	if (n === 'cp950') {
		return 'big5';
	}
	if (n.startsWith('cp') && /^\d+$/.test(n.slice(2))) {
		return n;
	}
	return n;
}

function appendJvmFlags(existing: string | undefined, flags: string): string {
	const cur = (existing || '').trim();
	const parts = flags.split(/\s+/).filter(Boolean);
	let next = cur;
	for (const flag of parts) {
		const key = flag.split('=')[0];
		if (next.includes(key)) {
			continue;
		}
		next = next ? `${next} ${flag}` : flag;
	}
	return next;
}
