import * as child_process from 'child_process';

/**
 * Spawn the Gradle wrapper safely.
 *
 * On Windows, Node (CVE-2024-27980) rejects `spawn('*.bat', …, { shell: false })`
 * with `EINVAL`. With allowlisted task args, `{ shell: true }` is the supported fix.
 * Avoid `cmd /c :app:install…` — leading `:` in Gradle tasks confuses cmd.exe and can
 * yield a bogus non-zero exit (e.g. -8) after a successful build.
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
		return child_process.spawn(gradlewPath, args, {
			...options,
			shell: true,
			windowsHide: true,
		});
	}
	return child_process.spawn(gradlewPath, args, {
		...options,
		shell: false,
	});
}
