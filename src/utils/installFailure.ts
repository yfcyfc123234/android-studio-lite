/**
 * @deprecated Prefer `runErrorRecovery.ts`. Re-exports kept for compatibility.
 */
export {
    classifyRecoverableInstallFailure,
    classifyRunError,
    tryRecoverInstallFailure,
    presentRunError,
    type UninstallReinstallAction as RecoverableInstallFailure,
} from './runErrorRecovery';
