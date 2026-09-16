/**
 * Detect adb/Gradle install failures that Android Studio offers to fix
 * by uninstalling the existing app and reinstalling.
 */

export interface RecoverableInstallFailure {
    /** e.g. INSTALL_FAILED_VERSION_DOWNGRADE */
    code: string;
    /** Short human-readable reason for the confirm dialog */
    summary: string;
}

const RECOVERABLE: Array<{ code: string; summary: string }> = [
    {
        code: 'INSTALL_FAILED_VERSION_DOWNGRADE',
        summary: 'The device already has a newer version of this app (version downgrade blocked).',
    },
    {
        code: 'INSTALL_FAILED_UPDATE_INCOMPATIBLE',
        summary: 'The existing app was signed with a different key (signature mismatch).',
    },
    {
        code: 'INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES',
        summary: 'The existing app has a different signing certificate.',
    },
    {
        code: 'INSTALL_FAILED_UID_CHANGED',
        summary: 'The existing app UID on the device conflicts with this install.',
    },
    {
        code: 'INSTALL_FAILED_SHARED_USER_INCOMPATIBLE',
        summary: 'The existing app shares a user id that is incompatible with this package.',
    },
    {
        code: 'INSTALL_FAILED_PERMISSION_MODEL_DOWNGRADE',
        summary: 'The existing app uses a newer permission model than this build.',
    },
    {
        code: 'INSTALL_FAILED_DUPLICATE_PERMISSION',
        summary: 'A permission defined by the existing app conflicts with this install.',
    },
];

/**
 * If the Gradle/adb error text indicates a recoverable install conflict,
 * return details for an uninstall-and-reinstall prompt; otherwise null.
 */
export function classifyRecoverableInstallFailure(errorText: string): RecoverableInstallFailure | null {
    if (!errorText) {
        return null;
    }
    for (const item of RECOVERABLE) {
        if (errorText.includes(item.code)) {
            return { code: item.code, summary: item.summary };
        }
    }
    return null;
}
