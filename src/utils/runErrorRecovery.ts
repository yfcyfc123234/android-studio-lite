/**
 * Run-time error classification + AS-style recovery UI for Android Studio Lite.
 *
 * Encapsulates:
 * - Detect common Gradle/adb install & device failures
 * - Modal confirm for recoverable conflicts (uninstall → reinstall)
 * - Tip dialogs for issues the user must fix manually
 */

import { window } from 'vscode';
import { showThemedAlert, showThemedConfirm } from '../ui/themedDialog';

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

const CONFIRM_UNINSTALL = '卸载并重装';

const RULES: PatternRule[] = [
    // —— Recoverable: uninstall then reinstall ——
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_FAILED_VERSION_DOWNGRADE',
        action: {
            code: 'INSTALL_FAILED_VERSION_DOWNGRADE',
            summary: '设备上已有更高版本，系统禁止降级安装。',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_FAILED_UPDATE_INCOMPATIBLE',
        action: {
            code: 'INSTALL_FAILED_UPDATE_INCOMPATIBLE',
            summary: '设备上的应用签名与当前包不一致。',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES',
        action: {
            code: 'INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES',
            summary: '设备上的应用证书与当前包不一致。',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_FAILED_UID_CHANGED',
        action: {
            code: 'INSTALL_FAILED_UID_CHANGED',
            summary: '设备上该应用的 UID 与本次安装冲突。',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_FAILED_SHARED_USER_INCOMPATIBLE',
        action: {
            code: 'INSTALL_FAILED_SHARED_USER_INCOMPATIBLE',
            summary: 'sharedUserId 与设备上已有应用不兼容。',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_FAILED_PERMISSION_MODEL_DOWNGRADE',
        action: {
            code: 'INSTALL_FAILED_PERMISSION_MODEL_DOWNGRADE',
            summary: '设备上应用的权限模型比当前包更新，无法覆盖安装。',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_FAILED_DUPLICATE_PERMISSION',
        action: {
            code: 'INSTALL_FAILED_DUPLICATE_PERMISSION',
            summary: '自定义权限与设备上已有定义冲突。',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },
    {
        kind: 'uninstall_reinstall',
        match: 'INSTALL_FAILED_ALREADY_EXISTS',
        action: {
            code: 'INSTALL_FAILED_ALREADY_EXISTS',
            summary: '包已存在且无法就地更新。',
            confirmLabel: CONFIRM_UNINSTALL,
        },
    },

    // —— Tips: user must act ——
    {
        kind: 'tip',
        match: 'INSTALL_FAILED_INSUFFICIENT_STORAGE',
        action: {
            code: 'INSTALL_FAILED_INSUFFICIENT_STORAGE',
            title: '存储空间不足',
            message: '请清理设备空间后重新 Run。',
        },
    },
    {
        kind: 'tip',
        match: 'INSTALL_FAILED_NO_MATCHING_ABIS',
        action: {
            code: 'INSTALL_FAILED_NO_MATCHING_ABIS',
            title: 'CPU 架构不匹配',
            message: '当前 APK 没有适配该设备 ABI 的原生库，请检查 ndk.abiFilters / splits。',
        },
    },
    {
        kind: 'tip',
        match: /INSTALL_FAILED_(OLDER|NEWER)_SDK/,
        action: {
            code: 'INSTALL_FAILED_SDK_MISMATCH',
            title: 'SDK / API 级别不匹配',
            message: 'minSdk 或 targetSdk 与设备不匹配，请调整 SDK 级别或换一台设备。',
        },
    },
    {
        kind: 'tip',
        match: 'INSTALL_FAILED_TEST_ONLY',
        action: {
            code: 'INSTALL_FAILED_TEST_ONLY',
            title: '仅测试包',
            message: '该包标记了 android:testOnly。请使用 debug install 任务，或 adb install -t。',
        },
    },
    {
        kind: 'tip',
        match: 'INSTALL_FAILED_USER_RESTRICTED',
        action: {
            code: 'INSTALL_FAILED_USER_RESTRICTED',
            title: '设备禁止安装',
            message: '请允许 USB 安装，或关闭厂商安装保护后再试。',
        },
    },
    {
        kind: 'tip',
        match: /INSTALL_(CANCELED_BY_USER|FAILED_ABORTED)/,
        action: {
            code: 'INSTALL_ABORTED',
            title: '安装已取消',
            message: '设备上取消了安装。请在手机弹窗中确认后重新 Run。',
        },
    },
    {
        kind: 'tip',
        match: 'INSTALL_FAILED_VERIFICATION_FAILURE',
        action: {
            code: 'INSTALL_FAILED_VERIFICATION_FAILURE',
            title: '包校验失败',
            message: '可临时关闭 Play 保护 / 包校验，或检查 APK 是否完整。',
        },
    },
    {
        kind: 'tip',
        match: /device\s+(unauthorized|offline)/i,
        action: {
            code: 'DEVICE_UNAUTHORIZED_OR_OFFLINE',
            title: '设备未就绪',
            message: '请重新连接 USB，确认授权弹窗（unauthorized），或等到设备 online。',
        },
    },
    {
        kind: 'tip',
        match: /no devices\/emulators found|error:\s*device not found/i,
        action: {
            code: 'NO_DEVICE',
            title: '没有可用设备',
            message: '请启动模拟器或连接已开启 USB 调试的真机，选中后再 Run。',
        },
    },
    {
        kind: 'tip',
        match: /Timed out waiting for .* to appear in adb|Emulator started but device not detected/i,
        action: {
            code: 'EMULATOR_BOOT_TIMEOUT',
            title: '模拟器未就绪',
            message: '模拟器启动超时。请从 AVD 列表手动启动，等到桌面后再 Run。',
        },
    },
    {
        kind: 'tip',
        match: /SDK path not configured|Gradle wrapper not found/i,
        action: {
            code: 'SDK_OR_PROJECT',
            title: '工程 / SDK 未配置',
            message: '请打开带 gradlew 的 Android 工程根目录，并设置 android-studio-lite.sdkPath（或 ANDROID_HOME）。',
        },
    },
    {
        kind: 'tip',
        match: /Could not resolve|Could not download|Received status code 4\d\d/i,
        action: {
            code: 'DEPENDENCY_RESOLVE',
            title: '依赖下载失败',
            message: '请检查网络 / 代理 / 仓库镜像后重试。',
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
 * If the install error is recoverable, show a themed confirm and run uninstall → reinstall.
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
        await showThemedAlert({
            title: '安装失败',
            heading: '无法自动卸载重装',
            message: `${action.summary}\n\n缺少 applicationId，无法自动卸载。请先在设备上手动卸载该应用，再重新 Run。`,
            code: action.code,
            severity: 'warning',
            primaryLabel: '知道了',
        });
        return 'cancelled';
    }

    const choice = await showThemedConfirm({
        title: '安装冲突',
        heading: '应用未能安装到设备',
        message: action.summary,
        code: action.code,
        details: [
            { label: '包名', value: ctx.applicationId },
            ...(ctx.targetLabel ? [{ label: '目标', value: ctx.targetLabel }] : []),
        ],
        prompt: '是否卸载设备上的现有应用并重新安装？',
        primaryLabel: action.confirmLabel,
        secondaryLabel: '取消',
        severity: 'warning',
    });

    if (choice !== 'primary') {
        return 'cancelled';
    }

    ctx.onProgress?.(`正在卸载 ${ctx.applicationId}...`);
    await ctx.uninstall();

    if (ctx.isCancelled?.()) {
        return 'cancelled';
    }

    ctx.onProgress?.('正在重新安装...');
    await ctx.reinstall();
    return 'recovered';
}

/**
 * Present a non-recoverable (or tip) run error to the user.
 * Tips use a themed alert; plain errors use an error toast.
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
        await showThemedAlert({
            title: '运行提示',
            heading: action.title,
            message: action.message,
            code: action.code,
            severity: 'warning',
            primaryLabel: '知道了',
        });
        return action;
    }
    if (action.kind === 'uninstall_reinstall') {
        // Should have been handled by tryRecoverInstallFailure; tip only.
        await showThemedAlert({
            title: '安装冲突',
            heading: '需要先卸载现有应用',
            message: `${action.summary}\n\n请在设备上手动卸载后重新 Run。`,
            code: action.code,
            severity: 'warning',
            primaryLabel: '知道了',
        });
        return action;
    }
    const prefix = options?.toastPrefix ?? '构建失败';
    await window.showErrorMessage(`${prefix}: ${action.message}`);
    return action;
}
