/**
 * Run-time error classification + AS-style recovery UI for Android Studio Lite.
 *
 * Encapsulates:
 * - Detect common Gradle/adb install & device failures
 * - Modal confirm for recoverable conflicts (uninstall → reinstall)
 * - Tip dialogs for issues the user must fix manually
 */

import { window } from 'vscode';

export type RunErrorKind =
    | 'uninstall_reinstall'
    | 'tip'
    | 'plain';

export interface UninstallReinstallAction {
    kind: 'uninstall_reinstall';
    code: string;
    summary: string;
    confirmLabel: string;
}

export interface TipAction {
    kind: 'tip';
    code: string;
    title: string;
    message: string;
}

export interface PlainAction {
    kind: 'plain';
    message: string;
}

export type RunErrorAction = UninstallReinstallAction | TipAction | PlainAction;

interface PatternRule {
    /** Substring or RegExp tested against the full error text */
    match: string | RegExp;
    action: Omit<UninstallReinstallAction, 'kind'> | Omit<TipAction, 'kind'>;
    kind: 'uninstall_reinstall' | 'tip';
}

const CONFIRM_UNINSTALL = 'Uninstall and Reinstall';

const RULES: PatternRule[] = [
    // —— Recoverable: uninstall then reinstall ——
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_FAILED_VERSION_DOWNGRADE',
        action: {
            code: 'INSTALL_FAILED_VERSION_DOWNGRADE',
            summary: 'The device already has a newer version of this app (downgrade blocked).',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_FAILED_UPDATE_INCOMPATIBLE',
        action: {
            code: 'INSTALL_FAILED_UPDATE_INCOMPATIBLE',
            summary: 'The existing app was signed with a different key (signature mismatch).',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES',
        action: {
            code: 'INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES',
            summary: 'The existing app has a different signing certificate.',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_FAILED_UID_CHANGED',
        action: {
            code: 'INSTALL_FAILED_UID_CHANGED',
            summary: 'The existing app UID on the device conflicts with this install.',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_FAILED_SHARED_USER_INCOMPATIBLE',
        action: {
            code: 'INSTALL_FAILED_SHARED_USER_INCOMPATIBLE',
            summary: 'Shared user id on the device is incompatible with this package.',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_FAILED_PERMISSION_MODEL_DOWNGRADE',
        action: {
            code: 'INSTALL_FAILED_PERMISSION_MODEL_DOWNGRADE',
            summary: 'The existing app uses a newer permission model than this build.',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_FAILED_DUPLICATE_PERMISSION',
        action: {
            code: 'INSTALL_FAILED_DUPLICATE_PERMISSION',
            summary: 'A permission defined by the existing app conflicts with this install.',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_FAILED_ALREADY_EXISTS',
        action: {
            code: 'INSTALL_FAILED_ALREADY_EXISTS',
            summary: 'The package is already installed and cannot be updated in place.',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },

    // —— Tips: user must act ——
    {
        kind: 'tip',
        match: 'INSTALL_FAILED_INSUFFICIENT_STORAGE',
        action: {
            code: 'INSTALL_FAILED_INSUFFICIENT_STORAGE',
            title: 'Not enough storage',
            message: 'Free space on the device, then Run again.',
        },
    },
    {
        kind: 'tip',
        match: 'INSTALL_FAILED_NO_MATCHING_ABIS',
        action: {
            code: 'INSTALL_FAILED_NO_MATCHING_ABIS',
            title: 'ABI mismatch',
            message: 'This APK has no native libraries for the device CPU. Check ndk.abiFilters / splits.',
        },
    },
    {
        kind: 'tip',
        match: /INSTALL_FAILED_(OLDER|NEWER)_SDK/,
        action: {
            code: 'INSTALL_FAILED_SDK_MISMATCH',
            title: 'SDK / API level mismatch',
            message: 'minSdk or targetSdk does not match this device. Adjust SDK levels or pick another device.',
        },
    },
    {
        kind: 'tip',
        match: 'INSTALL_FAILED_TEST_ONLY',
        action: {
            code: 'INSTALL_FAILED_TEST_ONLY',
            title: 'Test-only APK',
            message: 'This build is marked android:testOnly. Use a debug install task, or install with adb -t.',
        },
    },
    {
        kind: 'tip',
        match: 'INSTALL_FAILED_USER_RESTRICTED',
        action: {
            code: 'INSTALL_FAILED_USER_RESTRICTED',
            title: 'Install blocked by device',
            message: 'Allow USB install / disable MIUI|OPPO|Huawei install protection, then retry.',
        },
    },
    {
        kind: 'tip',
        match: /INSTALL_(CANCELED_BY_USER|FAILED_ABORTED)/,
        action: {
            code: 'INSTALL_ABORTED',
            title: 'Install canceled',
            message: 'Installation was canceled on the device. Confirm the on-device prompt and Run again.',
        },
    },
    {
        kind: 'tip',
        match: 'INSTALL_FAILED_VERIFICATION_FAILURE',
        action: {
            code: 'INSTALL_FAILED_VERIFICATION_FAILURE',
            title: 'Package verification failed',
            message: 'Disable Play Protect / package verifier temporarily, or check the APK integrity.',
        },
    },
    {
        kind: 'tip',
        match: /device\s+(unauthorized|offline)/i,
        action: {
            code: 'DEVICE_UNAUTHORIZED_OR_OFFLINE',
            title: 'Device not ready',
            message: 'Reconnect USB, accept the RSA prompt (unauthorized), or wait until the device is online.',
        },
    },
    {
        kind: 'tip',
        match: /no devices\/emulators found|error:\s*device not found/i,
        action: {
            code: 'NO_DEVICE',
            title: 'No device',
            message: 'Start an emulator or plug in a device with USB debugging, then select it and Run.',
        },
    },
    {
        kind: 'tip',
        match: /Timed out waiting for .* to appear in adb|Emulator started but device not detected/i,
        action: {
            code: 'EMULATOR_BOOT_TIMEOUT',
            title: 'Emulator not ready',
            message: 'The emulator did not become ready in time. Start it manually from the AVD list, wait for home screen, then Run.',
        },
    },
    {
        kind: 'tip',
        match: /SDK path not configured|Gradle wrapper not found/i,
        action: {
            code: 'SDK_OR_PROJECT',
            title: 'Project / SDK setup',
            message: 'Open an Android project root (with gradlew) and set android-studio-lite.sdkPath (or ANDROID_HOME).',
        },
    },
    {
        kind: 'tip',
        match: /Could not resolve|Could not download|Received status code 4\d\d/i,
        action: {
            code: 'DEPENDENCY_RESOLVE',
            title: 'Dependency download failed',
            message: 'Check network / proxy / repository mirrors, then Run again.',
        },
    },
];

function matches(text: string, rule: PatternRule): boolean {
    if (typeof rule.match === 'string') {
        return text.includes(rule.match);
    }
    return rule.match.test(text);
}

export function errorTextOf(error: unknown): string {
    if (!error) {
        return '';
    }
    if (typeof error === 'string') {
        return error;
    }
    const anyErr = error as { message?: string; stdout?: string; stderr?: string };
    return [anyErr.message, anyErr.stdout, anyErr.stderr].filter(Boolean).join('\n') || String(error);
}

/** Classify a Run/install error into uninstall-reinstall, tip, or plain. */
export function classifyRunError(error: unknown, fallbackMessage?: string): RunErrorAction {
    const text = errorTextOf(error);
    for (const rule of RULES) {
        if (matches(text, rule)) {
            if (rule.kind === 'uninstall_reinstall') {
                return { kind: 'uninstall_reinstall', ...(rule.action as Omit<UninstallReinstallAction, 'kind'>) };
            }
            return { kind: 'tip', ...(rule.action as Omit<TipAction, 'kind'>) };
        }
    }
    return {
        kind: 'plain',
        message: fallbackMessage || text || 'Unknown error',
    };
}

/** @deprecated Use classifyRunError; kept for callers that only care about uninstall recovery. */
export function classifyRecoverableInstallFailure(errorText: string): UninstallReinstallAction | null {
    const action = classifyRunError(errorText);
    return action.kind === 'uninstall_reinstall' ? action : null;
}

export interface InstallRecoveryContext {
    error: unknown;
    applicationId?: string;
    /** Short label for logs / dialogs (variant or task name) */
    targetLabel?: string;
    uninstall: () => Promise<void>;
    reinstall: () => Promise<void>;
    onProgress?: (message: string) => void;
    isCancelled?: () => boolean;
}

export type InstallRecoveryResult = 'recovered' | 'cancelled' | 'unhandled';

/**
 * If the install error is recoverable, show a modal confirm and run uninstall → reinstall.
 * Returns `unhandled` when the caller should fall through to normal failure UI.
 */
export async function tryRecoverInstallFailure(ctx: InstallRecoveryContext): Promise<InstallRecoveryResult> {
    if (ctx.isCancelled?.()) {
        return 'cancelled';
    }

    const action = classifyRunError(ctx.error);
    if (action.kind !== 'uninstall_reinstall') {
        return 'unhandled';
    }
    if (!ctx.applicationId) {
        await window.showWarningMessage(
            `The application could not be installed (${action.code}).\n\n` +
                `${action.summary}\n\n` +
                `No applicationId is available to uninstall automatically. Uninstall the app on the device, then Run again.`,
            { modal: true },
        );
        return 'cancelled';
    }

    const choice = await window.showWarningMessage(
        `The application could not be installed.\n\n` +
            `${action.code}\n${action.summary}\n\n` +
            `Package: ${ctx.applicationId}` +
            (ctx.targetLabel ? `\nTarget: ${ctx.targetLabel}` : '') +
            `\n\nDo you want to uninstall the existing application and reinstall?`,
        { modal: true },
        action.confirmLabel,
    );

    if (choice !== action.confirmLabel) {
        return 'cancelled';
    }

    ctx.onProgress?.(`Uninstalling ${ctx.applicationId}...`);
    await ctx.uninstall();

    if (ctx.isCancelled?.()) {
        return 'cancelled';
    }

    ctx.onProgress?.('Reinstalling...');
    await ctx.reinstall();
    return 'recovered';
}

/**
 * Present a non-recoverable (or tip) run error to the user.
 * Tips use a modal warning; plain errors use an error toast.
 */
export async function presentRunError(
    error: unknown,
    options?: {
        /** Prefer this string for plain errors (e.g. extracted Gradle summary) */
        plainMessage?: string;
        /** Prefix for error toast, default "Build failed" */
        toastPrefix?: string;
    },
): Promise<RunErrorAction> {
    const action = classifyRunError(error, options?.plainMessage);
    if (action.kind === 'tip') {
        await window.showWarningMessage(
            `${action.title}\n\n${action.message}\n\n(${action.code})`,
            { modal: true },
            'OK',
        );
        return action;
    }
    if (action.kind === 'uninstall_reinstall') {
        // Should have been handled by tryRecoverInstallFailure; tip only.
        await window.showWarningMessage(
            `${action.code}\n${action.summary}\n\nUninstall the app on the device and Run again.`,
            { modal: true },
            'OK',
        );
        return action;
    }
    const prefix = options?.toastPrefix ?? 'Build failed';
    await window.showErrorMessage(`${prefix}: ${action.message}`);
    return action;
}
