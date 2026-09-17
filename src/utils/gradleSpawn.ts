import * as child_process from 'child_process';

/**
 * Spawn the Gradle wrapper safely.
 *
 * On Windows, Node (CVE-2024-27980) rejects `spawn('gradlew.bat', …, { shell: false })`
 * with `EINVAL`. We invoke `cmd.exe /d /s /c <bat> <args…>` so the `.bat` still runs,
 * while keeping the Gradle task as a separate argv element (no shell string concat).
 *
 * Task args are restricted to Gradle-safe tokens to avoid cmd metacharacter injection.
 */

const SAFE_GRADLE_ARG = /^:?[\w][\w.:-]*$/;

export function assertSafeGradleArg(arg: string): string {
	const trimmed = String(arg || '').trim();
	if (!SAFE_GRADLE_ARG.test(trimmed)) {
		throw new Error(`Unsafe Gradle argument rejected: ${arg}`);
	}
	return trimmed;
}

export function spawnGradleWrapper(
	gradlewPath: string,
	taskArgs: string[],
	options: child_process.SpawnOptions,
): child_process.ChildProcess {
	const args = taskArgs.map(assertSafeGradleArg);
	if (process.platform === 'win32') {
		const comspec = process.env.ComSpec || 'cmd.exe';
		const batArg = /\s/.test(gradlewPath) ? `"${gradlewPath}"` : gradlewPath;
		return child_process.spawn(comspec, ['/d', '/s', '/c', batArg, ...args], {
			...options,
			shell: false,
			windowsHide: true,
		});
	}
	return child_process.spawn(gradlewPath, args, {
		...options,
		shell: false,
	});
}
