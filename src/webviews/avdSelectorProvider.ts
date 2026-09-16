import type { Disposable, ExtensionContext } from 'vscode';
import { Disposable as VSCodeDisposable, window, commands, workspace, ProgressLocation, CancellationTokenSource } from 'vscode';
import type { WebviewProvider, WebviewHost } from './webviewProvider.js';
import type { WebviewState } from './protocol.js';
import { Manager } from '../core';
import type { MuduleBuildVariant } from '../service/BuildVariantService';
import { EmulatorBootService } from '../device/EmulatorBootService.js';
import { LogcatService } from '../service/LogcatService.js';
import { WORKSPACE_SELECTED_DEVICE_SERIAL } from '../service/ScreenshotService.js';
import { formatAdbDeviceLabel, listOnlineAdbDevices } from '../utils/adbDevices.js';

/** Unified run target shown in the device dropdown. */
export interface RunTarget {
    /** physical:<serial> | emulator:<serial> | avd:<name> */
    id: string;
    kind: 'physical' | 'emulator' | 'avd';
    label: string;
    serial?: string;
    avdName?: string;
}

const SELECTED_TARGET_ID_KEY = 'android-studio-lite.selectedTargetId';
const SAFE_ADB_SERIAL = /^[A-Za-z0-9._:-]+$/;
const SAFE_APPLICATION_ID = /^[A-Za-z0-9._]+$/;

export interface AVDSelectorWebviewState extends WebviewState {
    targets?: RunTarget[];
    selectedTargetId?: string;
    modules?: MuduleBuildVariant[];
    selectedModule?: string;
    /** When false, show "Open an Android project" placeholder. */
    isAndroidProject?: boolean;
    /** When false, logcat modules are not available; hide Logcat toggle. */
    logcatAvailable?: boolean;
}

export class AVDSelectorProvider implements WebviewProvider<AVDSelectorWebviewState> {
    private readonly disposables: Disposable[] = [];
    private readonly manager: Manager;
    private buildCancellationTokens = new Map<string, CancellationTokenSource>();
    private logcatActive: boolean = false;
    /** Last target id chosen in the sidebar (survives target list refreshes). */
    private selectedTargetId: string | undefined;

    constructor(
        private readonly host: WebviewHost,
        private readonly context: ExtensionContext,
        private readonly logcatAvailable: boolean = false,
    ) {
        this.manager = Manager.getInstance();
        this.selectedTargetId = this.context.workspaceState.get<string>(SELECTED_TARGET_ID_KEY);
        this.disposables.push(
            workspace.onDidChangeWorkspaceFolders(async () => {
                const isAndroidProject = this.manager.buildVariant.isAndroidProject();
                await this.host.notify('update-android-project-state', {
                    isAndroidProject,
                });
                if (isAndroidProject) {
                    await this.sendModules();
                }
            }),
        );
    }

    getTelemetryContext(): Record<string, string | number | boolean | undefined> {
        return {
            'webview.id': this.host.id,
            'webview.instanceId': this.host.instanceId,
        };
    }

    async includeBootstrap(): Promise<AVDSelectorWebviewState> {
        const targets = await this.buildRunTargets();
        const saved =
            this.selectedTargetId ||
            this.context.workspaceState.get<string>(SELECTED_TARGET_ID_KEY);
        const selectedTargetId =
            (saved && targets.some(t => t.id === saved) ? saved : undefined) ||
            this.pickDefaultTargetId(targets);
        this.selectedTargetId = selectedTargetId;

        const isAndroidProject = this.manager.buildVariant.isAndroidProject();

        // Get modules and filter for application type (only when Android project)
        let modules: MuduleBuildVariant[] = [];
        if (isAndroidProject) {
            try {
                const allModules = await this.manager.buildVariant.getModuleBuildVariants(this.context);
                modules = allModules.filter(m => m.type === 'application');
            } catch (error) {
                console.error('[AVDSelectorProvider] Error loading modules:', error);
            }
        }
        const selectedModule = modules.length > 0 ? modules[0].module : undefined;

        try {
            this.logcatActive = false;
        } catch (error) {
            console.error('[AVDSelectorProvider] Error checking logcat state:', error);
        }

        return {
            ...this.host.baseWebviewState,
            targets,
            selectedTargetId,
            modules,
            selectedModule,
            isAndroidProject,
            logcatAvailable: this.logcatAvailable,
        };
    }

    async onReady(): Promise<void> {
        console.log('[AVDSelector] Ready');
        await this.sendTargets();
        await this.sendModules();
        await this.host.notify('logcat-state-changed', { active: this.logcatActive });
    }

    onMessageReceived?(e: any): void {
        if (e.type === 'open-folder') {
            void commands.executeCommand('workbench.action.files.openFolder');
            return;
        }
        if (e.type === 'refresh-targets' || e.type === 'refresh-avds') {
            void this.sendTargets();
        } else if (e.type === 'refresh-modules') {
            void this.sendModules();
        } else if (e.type === 'select-target' || e.type === 'select-avd') {
            const targetId = e.params?.targetId || (e.params?.avdName ? `avd:${e.params.avdName}` : undefined);
            if (targetId) {
                this.selectedTargetId = targetId;
                void this.context.workspaceState.update(SELECTED_TARGET_ID_KEY, targetId);
                void this.host.notify('target-selected', { targetId });
                if (typeof targetId === 'string' && (targetId.startsWith('physical:') || targetId.startsWith('emulator:'))) {
                    const serial = targetId.slice(targetId.indexOf(':') + 1);
                    void this.context.workspaceState.update(WORKSPACE_SELECTED_DEVICE_SERIAL, serial);
                }
            }
        } else if (e.type === 'select-module') {
            const { moduleName } = e.params || {};
            if (moduleName) {
                void this.host.notify('module-selected', { moduleName });
            }
        } else if (e.type === 'run-app') {
            void this.handleRunApp(e.params);
        } else if (e.type === 'cancel-build') {
            void this.handleCancelBuild(e.params);
        } else if (e.type === 'toggle-logcat') {
            void this.handleToggleLogcat(e.params);
        } else if (e.type === 'take-screenshot') {
            void commands.executeCommand('android-studio-lite.takeScreenshot', e.params?.serial);
        }
    }

    private async handleRunApp(params: any): Promise<void> {
        const {
            targetId,
            kind: kindParam,
            serial: serialParam,
            avdName,
            moduleName,
            cancellationToken,
        } = params || {};

        const kind: 'physical' | 'emulator' | 'avd' =
            kindParam ||
            (typeof targetId === 'string' && targetId.startsWith('physical:')
                ? 'physical'
                : typeof targetId === 'string' && targetId.startsWith('emulator:')
                    ? 'emulator'
                    : 'avd');
        const resolvedAvdName = avdName ||
            (typeof targetId === 'string' && targetId.startsWith('avd:') ? targetId.slice(4) : undefined);
        const serial = serialParam ||
            (typeof targetId === 'string' && targetId.startsWith('physical:')
                ? targetId.slice('physical:'.length)
                : typeof targetId === 'string' && targetId.startsWith('emulator:')
                    ? targetId.slice('emulator:'.length)
                    : undefined);

        if (!moduleName || (kind === 'avd' && !resolvedAvdName) || ((kind === 'physical' || kind === 'emulator') && !serial)) {
            await this.host.notify('build-failed', { error: 'Device and Module must be selected' });
            return;
        }

        const cancelToken = new CancellationTokenSource();
        if (cancellationToken) {
            this.buildCancellationTokens.set(cancellationToken, cancelToken);
        }

        try {
            await this.host.notify('build-started', { cancellationToken });

            const adbPath = this.getAdbPath();
            if (!adbPath) {
                await this.host.notify('build-failed', { error: 'SDK path not configured. Run Setup Wizard / set android-studio-lite.sdkPath.' });
                return;
            }

            const modules = await this.manager.buildVariant.getModuleBuildVariants(this.context);
            const module = modules.find(m => m.module === moduleName && m.type === 'application');
            if (!module || !module.variants || module.variants.length === 0) {
                await this.host.notify('build-failed', { error: 'No build variants found for module' });
                return;
            }

            const selectedVariants = this.context.workspaceState.get<Record<string, string>>(
                'android-studio-lite.selectedBuildVariants',
                {}
            );
            const variantName = selectedVariants[moduleName] || module.variants[0].name;
            const variant = module.variants.find(v => v.name === variantName) || module.variants[0];

            // Prefer metadata install task; fall back for older scripts that only
            // exposed install on debug (release had bundle only).
            let installTask = variant.tasks.install;
            if (!installTask && module.type === 'application') {
                const cap = variantName.charAt(0).toUpperCase() + variantName.slice(1);
                installTask = `${moduleName}:install${cap}`;
                console.log(`[AVDSelectorProvider] install task missing in metadata; falling back to ${installTask}`);
            }
            if (!installTask) {
                await this.host.notify('build-failed', { error: `No install task found for variant ${variantName}` });
                return;
            }

            const targetLabel = (kind === 'physical' || kind === 'emulator')
                ? (serial as string)
                : (resolvedAvdName as string);

            await window.withProgress(
                {
                    location: ProgressLocation.Notification,
                    title: `Building and installing ${variantName}`,
                    cancellable: true,
                },
                async (progress, token) => {
                    token.onCancellationRequested(() => {
                        cancelToken.cancel();
                        this.manager.gradle.cancelBuild();
                    });

                    try {
                        let deviceSerial: string;

                        if (kind === 'physical' || kind === 'emulator') {
                            progress.report({ increment: 10, message: `Using device ${serial}...` });
                            deviceSerial = serial as string;
                            await this.context.workspaceState.update(
                                WORKSPACE_SELECTED_DEVICE_SERIAL,
                                deviceSerial,
                            );
                        } else {
                            const emulatorPath = this.manager.android.getEmulator();
                            if (!emulatorPath) {
                                throw new Error('Emulator not configured. Run Setup Wizard or pick a physical device.');
                            }
                            const bootService = new EmulatorBootService(
                                adbPath,
                                emulatorPath,
                                { appendLine: (line) => this.manager.output.append(line) },
                            );
                            deviceSerial = await bootService.launchAndWait(
                                resolvedAvdName as string,
                                progress,
                                cancelToken.token,
                            );
                        }

                        if (cancelToken.token.isCancellationRequested) {
                            throw new Error('Build was cancelled');
                        }

                        progress.report({ increment: 0, message: `Installing ${installTask}...` });
                        console.log(`[AVDSelectorProvider] Starting gradle install task: ${installTask} → ${deviceSerial}`);

                        await this.manager.gradle.installVariant(
                            installTask,
                            (output) => {
                                const lines = output.split('\n').filter(l => l.trim());
                                const lastLine = lines[lines.length - 1];
                                if (lastLine && lastLine.length < 100) {
                                    progress.report({ message: lastLine });
                                }
                            },
                            cancelToken.token,
                            deviceSerial,
                        );

                        console.log(`[AVDSelectorProvider] Gradle install task completed successfully: ${installTask}`);

                        progress.report({ increment: 90, message: 'Installation completed! Launching app...' });

                        try {
                            const applicationId = variant.applicationId;
                            if (!applicationId) {
                                throw new Error(`No applicationId found for variant ${variantName}. Please ensure the gradle script includes applicationId for application modules.`);
                            }
                            await this.launchApp(applicationId, deviceSerial);
                            LogcatService.setLastRun(this.context, applicationId, deviceSerial);
                            progress.report({ increment: 100, message: 'App launched successfully!' });
                            window.showInformationMessage(`App installed and launched on ${targetLabel}`);
                        } catch (launchError: any) {
                            console.error('[AVDSelectorProvider] Error launching app:', launchError);
                            progress.report({ increment: 100, message: 'Installation completed (launch failed)' });
                            window.showWarningMessage(`App installed but failed to launch: ${launchError.message || String(launchError)}`);
                        }

                        await this.host.notify('build-completed', {});
                    } catch (error: any) {
                        if (cancelToken.token.isCancellationRequested || token.isCancellationRequested) {
                            throw new Error('Build was cancelled');
                        }
                        throw error;
                    }
                }
            );
        } catch (error: any) {
            console.error('[AVDSelectorProvider] Error in handleRunApp:', error);
            if (error.name === 'CancellationError' || cancelToken.token.isCancellationRequested || error.message === 'Build was cancelled') {
                await this.host.notify('build-cancelled', {});
                window.showInformationMessage('Build was cancelled');
            } else {
                let errorMessage = this.extractBuildErrorMessage(error);

                console.error('[AVDSelectorProvider] Build failed with error:', errorMessage);
                console.error('[AVDSelectorProvider] Full error object:', error);
                await this.host.notify('build-failed', { error: errorMessage });
                window.showErrorMessage(`Build failed: ${errorMessage}`);
            }
        } finally {
            if (cancellationToken) {
                this.buildCancellationTokens.delete(cancellationToken);
            }
            cancelToken.dispose();
        }
    }

    private async handleCancelBuild(params: any): Promise<void> {
        const { cancellationToken } = params || {};
        if (cancellationToken) {
            const cancelToken = this.buildCancellationTokens.get(cancellationToken);
            if (cancelToken) {
                cancelToken.cancel();
                this.manager.gradle.cancelBuild();
                this.buildCancellationTokens.delete(cancellationToken);
                await this.host.notify('build-cancelled', {});
            }
        }
    }

    private async handleToggleLogcat(params: any): Promise<void> {
        const { active } = params || {};
        this.logcatActive = active;

        try {
            if (active) {
                // Start logcat and show logcat output channel
                await commands.executeCommand('android-studio-lite.startLogcat');
                // Hide Android Studio Lite output channel
                this.manager.output.hide();
            } else {
                // Stop logcat and show Android Studio Lite output channel
                await commands.executeCommand('android-studio-lite.stopLogcat');
                // Show Android Studio Lite output channel
                this.manager.output.show();
            }
            // Notify webview of state change
            await this.host.notify('logcat-state-changed', { active: this.logcatActive });
        } catch (error: any) {
            console.error('[AVDSelectorProvider] Error toggling logcat:', error);
            // Revert state on error
            this.logcatActive = !active;
            await this.host.notify('logcat-state-changed', { active: this.logcatActive });
            window.showErrorMessage(`Failed to ${active ? 'start' : 'stop'} logcat: ${error.message || String(error)}`);
        }
    }

    private async ensureAVDRunning(avdName: string, cancellationToken: any): Promise<void> {
        // Check if AVD is already running by checking ADB devices
        const isRunning = await this.checkIfAVDRunning(avdName);

        if (isRunning) {
            console.log(`[AVDSelectorProvider] AVD ${avdName} is already running, skipping launch`);
            return;
        }

        console.log(`[AVDSelectorProvider] AVD ${avdName} is not running, launching emulator...`);

        // Launch the emulator with progress notification
        try {
            await window.withProgress(
                {
                    location: ProgressLocation.Notification,
                    title: `Booting emulator: ${avdName}`,
                    cancellable: false,
                },
                async (progress) => {
                    try {
                        progress.report({ increment: 0, message: 'Starting emulator...' });
                        // Launch emulator (this spawns and returns immediately)
                        await this.manager.avd.launchEmulator(avdName);

                        // Wait for device to be ready (poll for up to 60 seconds)
                        progress.report({ increment: 30, message: 'Waiting for device...' });
                        let deviceFound = false;
                        for (let i = 0; i < 60; i++) {
                            if (cancellationToken.isCancellationRequested) {
                                throw new Error('Build was cancelled');
                            }

                            await new Promise(resolve => setTimeout(resolve, 1000));
                            const running = await this.checkIfAVDRunning(avdName);
                            if (running) {
                                deviceFound = true;
                                break;
                            }
                            progress.report({
                                increment: 30 + (i / 60) * 40,
                                message: `Waiting for device... (${i + 1}/60)`,
                            });
                        }

                        if (!deviceFound) {
                            throw new Error('Emulator started but device not detected. Please check if emulator is running.');
                        }
                        progress.report({ increment: 100, message: 'Device ready!' });
                        // Small delay to ensure notification closes properly
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } catch (error: any) {
                        // Re-throw to be caught by outer try-catch
                        throw error;
                    }
                }
            );
        } catch (error: any) {
            console.error('[AVDSelectorProvider] Error launching emulator:', error);
            // Check if error is because emulator is already running
            const errorMessage = error?.message || error?.toString() || String(error);
            if (errorMessage.includes('Running multiple emulators') || errorMessage.includes('already running')) {
                console.log('[AVDSelectorProvider] Emulator appears to be already running, checking again...');
                // Wait a moment and check again
                await new Promise(resolve => setTimeout(resolve, 2000));
                const isRunningNow = await this.checkIfAVDRunning(avdName);
                if (isRunningNow) {
                    console.log('[AVDSelectorProvider] Emulator is now detected as running');
                    return; // Success - emulator is running
                }
            }
            throw error;
        }
    }

    private async launchApp(applicationId: string, serial?: string): Promise<void> {
        const config = this.manager.getConfig();
        const sdkPath = config.sdkPath;
        if (!sdkPath) {
            throw new Error('SDK path not configured');
        }
        if (!SAFE_APPLICATION_ID.test(applicationId)) {
            throw new Error(`Invalid applicationId: ${applicationId}`);
        }
        if (serial && !SAFE_ADB_SERIAL.test(serial)) {
            throw new Error(`Invalid device serial: ${serial}`);
        }

        const pathMod = await import('path');
        const platformToolsPath = pathMod.join(sdkPath, 'platform-tools');
        const adbPath = pathMod.join(platformToolsPath, process.platform === 'win32' ? 'adb.exe' : 'adb');

        console.log(`[AVDSelectorProvider] Launching app with applicationId: ${applicationId}`);

        const args = serial
            ? ['-s', serial, 'shell', 'monkey', '-p', applicationId, '-c', 'android.intent.category.LAUNCHER', '1']
            : ['shell', 'monkey', '-p', applicationId, '-c', 'android.intent.category.LAUNCHER', '1'];

        try {
            const { execFile } = await import('child_process');
            const { promisify } = await import('util');
            const execFileAsync = promisify(execFile);
            const result = await execFileAsync(adbPath, args, { windowsHide: true, timeout: 30000 });
            console.log(`[AVDSelectorProvider] App launch command output: ${result.stdout}`);
        } catch (error: any) {
            if (error.stdout && !String(error.stdout).includes('Error')) {
                console.log(`[AVDSelectorProvider] App launched (monkey output): ${error.stdout}`);
                return;
            }
            throw new Error(`Failed to launch app: ${error.message || String(error)}`);
        }
    }

    private extractBuildErrorMessage(error: any): string {
        // Extract error message more reliably
        let errorMessage = 'Unknown error';
        if (error?.message) {
            errorMessage = error.message;
        } else if (error?.toString && typeof error.toString === 'function') {
            errorMessage = error.toString();
        } else if (typeof error === 'string') {
            errorMessage = error;
        } else {
            errorMessage = JSON.stringify(error);
        }

        // Try to extract the most relevant error from Gradle output
        // Common patterns:
        // 1. "What went wrong:" followed by error description
        // 2. "FAILURE: Build failed with an exception."
        // 3. Task-specific errors like "Execution failed for task"

        const lines = errorMessage.split('\n');
        const relevantLines: string[] = [];

        // Look for key error indicators
        let captureNext = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Capture "What went wrong:" section
            if (line.includes('What went wrong:') || line.includes('FAILURE:')) {
                captureNext = true;
                if (line.includes('FAILURE:')) {
                    relevantLines.push(line);
                }
                continue;
            }

            // Capture "Execution failed for task" lines
            if (line.includes('Execution failed for task')) {
                relevantLines.push(line);
                captureNext = true;
                continue;
            }

            // Capture lines after "What went wrong:" (usually the actual error)
            if (captureNext && line && !line.startsWith('*') && !line.startsWith('>') && !line.includes('Try:') && !line.includes('Run with')) {
                if (line.length > 0 && !line.match(/^\s*$/)) {
                    relevantLines.push(line);
                    // Stop capturing after we get a meaningful error line
                    if (line.length > 20 && !line.includes('Get more help')) {
                        captureNext = false;
                    }
                }
            }

            // Stop capturing on certain markers
            if (line.includes('Try:') || line.includes('Run with') || line.includes('Get more help')) {
                captureNext = false;
            }
        }

        // If we found relevant lines, use them; otherwise use the original message
        if (relevantLines.length > 0) {
            // Join relevant lines, but limit to first 3-4 most important ones
            const extracted = relevantLines.slice(0, 4).join(' ').trim();
            if (extracted.length > 0) {
                return extracted;
            }
        }

        // Fallback: try to find the first meaningful error line
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed &&
                trimmed.length > 20 &&
                !trimmed.includes('BUILD FAILED') &&
                !trimmed.includes('FAILURE:') &&
                !trimmed.includes('Try:') &&
                !trimmed.includes('Run with') &&
                (trimmed.includes('failed') || trimmed.includes('error') || trimmed.includes('Error'))) {
                return trimmed;
            }
        }

        return errorMessage;
    }

    /** Returns the first running emulator serial (e.g. "emulator-5554") or null. */
    private async getRunningEmulatorSerial(): Promise<string | null> {
        try {
            const adbPath = this.getAdbPath();
            if (!adbPath) return null;

            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            const result = await execAsync(`"${adbPath}" devices`);
            const output = result.stdout;

            const lines = output.split('\n').filter((line: string) => {
                const trimmed = line.trim();
                return trimmed && !trimmed.startsWith('List of devices');
            });

            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2 && parts[0].startsWith('emulator-') && parts[1] === 'device') {
                    console.log(`[AVDSelectorProvider] Found running emulator device: ${parts[0]}`);
                    return parts[0];
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    private getAdbPath(): string | null {
        const config = this.manager.getConfig();
        const sdkPath = config.sdkPath;
        if (!sdkPath) return null;
        const path = require('path');
        const platformToolsPath = path.join(sdkPath, 'platform-tools');
        return path.join(platformToolsPath, process.platform === 'win32' ? 'adb.exe' : 'adb');
    }

    private async checkIfAVDRunning(_avdName: string): Promise<boolean> {
        const serial = await this.getRunningEmulatorSerial();
        return serial !== null;
    }

    async onRefresh?(force?: boolean): Promise<void> {
        if (force) {
            await this.manager.avd.getAVDList(true);
            this.manager.buildVariant.clearCache();
        }
        await this.sendTargets();
        await this.sendModules();
    }

    private pickDefaultTargetId(targets: RunTarget[]): string | undefined {
        const physical = targets.find(t => t.kind === 'physical');
        if (physical) {
            return physical.id;
        }
        const emulator = targets.find(t => t.kind === 'emulator');
        if (emulator) {
            return emulator.id;
        }
        return targets[0]?.id;
    }

    private async buildRunTargets(): Promise<RunTarget[]> {
        const targets: RunTarget[] = [];
        const adbPath = this.getAdbPath();

        if (adbPath) {
            try {
                const online = await listOnlineAdbDevices(adbPath);
                for (const d of online) {
                    if (d.kind === 'emulator') {
                        targets.push({
                            id: `emulator:${d.serial}`,
                            kind: 'emulator',
                            label: formatAdbDeviceLabel(d),
                            serial: d.serial,
                        });
                    } else {
                        targets.push({
                            id: `physical:${d.serial}`,
                            kind: 'physical',
                            label: formatAdbDeviceLabel(d),
                            serial: d.serial,
                        });
                    }
                }
            } catch (error) {
                console.error('[AVDSelectorProvider] Failed to list adb devices:', error);
            }
        }

        try {
            const avds = await this.manager.avd.getAVDList();
            for (const avd of avds || []) {
                targets.push({
                    id: `avd:${avd.name}`,
                    kind: 'avd',
                    label: `AVD: ${avd.name}`,
                    avdName: avd.name,
                });
            }
        } catch (error) {
            console.error('[AVDSelectorProvider] Failed to list AVDs:', error);
        }

        return targets;
    }

    private async sendTargets(): Promise<void> {
        const targets = await this.buildRunTargets();
        const saved =
            this.selectedTargetId ||
            this.context.workspaceState.get<string>(SELECTED_TARGET_ID_KEY);
        const selectedTargetId =
            (saved && targets.some(t => t.id === saved) ? saved : undefined) ||
            this.pickDefaultTargetId(targets);
        this.selectedTargetId = selectedTargetId;
        await this.host.notify('update-targets', { targets, selectedTargetId });
    }

    private async sendModules(): Promise<void> {
        if (!this.manager.buildVariant.isAndroidProject()) {
            await this.host.notify('update-modules', { modules: [] });
            return;
        }
        try {
            const allModules = await this.manager.buildVariant.getModuleBuildVariants(this.context);
            const modules = allModules.filter(m => m.type === 'application');
            await this.host.notify('update-modules', { modules });
        } catch (error) {
            console.error('[AVDSelectorProvider] Error sending modules:', error);
            await this.host.notify('update-modules', { modules: [] });
        }
    }

    registerCommands(): Disposable[] {
        return [];
    }

    dispose(): void {
        for (const cancelToken of this.buildCancellationTokens.values()) {
            cancelToken.cancel();
            cancelToken.dispose();
        }
        this.buildCancellationTokens.clear();
        this.disposables.forEach(d => d.dispose());
    }
}
