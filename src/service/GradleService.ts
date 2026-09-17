import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';
import { Service } from "./Service";
import { Manager } from "../core";
import { GradleExecutable } from "../cmd/Gradle";
import { showMsg, MsgType } from '../module/ui';
import {
    StreamingProcessDecoder,
    withJavaUtf8ProcessEnv,
} from '../utils/processOutputEncoding';

export class GradleService extends Service {
    readonly manager: Manager;
    readonly gradle: GradleExecutable;
    readonly workspacePath: string;
    private buildProcess: child_process.ChildProcess | null = null;

    constructor(manager: Manager) {
        super(manager);
        this.manager = manager;
        this.gradle = new GradleExecutable(manager);
        this.workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    }

    public async installVariant(
        variantTask: string,
        onOutput?: (output: string) => void,
        cancellationToken?: vscode.CancellationToken,
        /** When set, Gradle/adb installs to this serial (ANDROID_SERIAL). */
        deviceSerial?: string,
        options?: {
            /** When false, skip the failure toast (caller shows a confirm dialog instead). Default true. */
            notifyOnFailure?: boolean;
        },
    ): Promise<void> {
        const notifyOnFailure = options?.notifyOnFailure !== false;
        if (!this.workspacePath) {
            throw new Error("No workspace folder found");
        }

        // Check if gradlew exists
        const gradlewPath = path.join(this.workspacePath, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
        const fs = await import('fs');
        if (!fs.existsSync(gradlewPath)) {
            throw new Error("Gradle wrapper not found. Please ensure you are in an Android project root.");
        }

        // Spawn wrapper with shell:false; task path is a separate argv element (never shell-interpolated).
        const runGradleTask = (
            taskPath: string,
            spawnEnv: NodeJS.ProcessEnv,
        ): Promise<{ stdout: string; stderr: string }> =>
            new Promise((resolve, reject) => {
                if (cancellationToken?.isCancellationRequested) {
                    reject(new Error("Build was cancelled"));
                    return;
                }

                const spawnOptions: child_process.SpawnOptions = {
                    shell: false,
                    cwd: this.workspacePath,
                    env: spawnEnv,
                    windowsHide: true,
                };

                this.buildProcess = child_process.spawn(gradlewPath, [taskPath], spawnOptions);

                let stdout = '';
                let stderr = '';
                const stdoutDec = new StreamingProcessDecoder();
                const stderrDec = new StreamingProcessDecoder();

                const emitOut = (text: string, isErr: boolean) => {
                    if (!text) {
                        return;
                    }
                    if (isErr) {
                        stderr += text;
                        onOutput?.(text);
                        this.manager.output.append(text, "error");
                    } else {
                        stdout += text;
                        onOutput?.(text);
                        this.manager.output.append(text);
                    }
                };

                if (this.buildProcess.stdout) {
                    this.buildProcess.stdout.on('data', (data: Buffer) => {
                        emitOut(stdoutDec.push(data), false);
                    });
                }

                if (this.buildProcess.stderr) {
                    this.buildProcess.stderr.on('data', (data: Buffer) => {
                        emitOut(stderrDec.push(data), true);
                    });
                }

                if (cancellationToken) {
                    const cancellationListener = cancellationToken.onCancellationRequested(() => {
                        if (this.buildProcess) {
                            this.buildProcess.kill('SIGTERM');
                            this.buildProcess = null;
                        }
                        reject(new Error("Build was cancelled"));
                    });
                    this.buildProcess.on('close', () => {
                        cancellationListener.dispose();
                    });
                }

                this.buildProcess.on('error', (error) => {
                    this.buildProcess = null;
                    reject(error);
                });

                this.buildProcess.on('close', (code) => {
                    this.buildProcess = null;
                    emitOut(stdoutDec.end(), false);
                    emitOut(stderrDec.end(), true);
                    if (code === 0) {
                        resolve({ stdout, stderr });
                    } else {
                        const errorMsg = stderr || stdout || `Gradle build failed with exit code ${code}`;
                        reject(Object.assign(new Error(errorMsg), { code, stdout, stderr }));
                    }
                });
            });

        try {
            await runGradleTask(variantTask, withJavaUtf8ProcessEnv({
                ...process.env,
                ...(deviceSerial ? { ANDROID_SERIAL: deviceSerial } : {}),
            }));
            showMsg(MsgType.info, `${variantTask} installed successfully.`);
        } catch (error: any) {
            if (error?.message === "Build was cancelled") {
                throw error;
            }
            const stderr = error?.stderr || '';
            if (stderr) {
                this.manager.output.append(stderr, "error");
            }
            console.error(`[GradleService] Build failed for ${variantTask}:`, error);
            if (notifyOnFailure) {
                showMsg(MsgType.error, `Failed to install ${variantTask}: ${error?.message || error}`);
            }
            throw error instanceof Error ? error : new Error(String(error));
        }
    }

    public async assembleVariant(
        variantTask: string,
        onOutput?: (output: string) => void,
        cancellationToken?: vscode.CancellationToken
    ): Promise<void> {
        if (!this.workspacePath) {
            throw new Error("No workspace folder found");
        }

        const gradlewPath = path.join(this.workspacePath, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
        const fs = await import('fs');
        if (!fs.existsSync(gradlewPath)) {
            throw new Error("Gradle wrapper not found. Please ensure you are in an Android project root.");
        }

        return new Promise<void>((resolve, reject) => {
            if (cancellationToken?.isCancellationRequested) {
                reject(new Error("Build was cancelled"));
                return;
            }

            const spawnOptions: child_process.SpawnOptions = {
                shell: false,
                cwd: this.workspacePath,
                env: withJavaUtf8ProcessEnv(process.env),
                windowsHide: true,
            };

            this.buildProcess = child_process.spawn(gradlewPath, [variantTask], spawnOptions);

            let stdout = '';
            let stderr = '';
            const stdoutDec = new StreamingProcessDecoder();
            const stderrDec = new StreamingProcessDecoder();

            const emitOut = (text: string, isErr: boolean) => {
                if (!text) {
                    return;
                }
                if (isErr) {
                    stderr += text;
                    onOutput?.(text);
                    this.manager.output.append(text, "error");
                } else {
                    stdout += text;
                    onOutput?.(text);
                    this.manager.output.append(text);
                }
            };

            if (this.buildProcess.stdout) {
                this.buildProcess.stdout.on('data', (data: Buffer) => {
                    emitOut(stdoutDec.push(data), false);
                });
            }

            if (this.buildProcess.stderr) {
                this.buildProcess.stderr.on('data', (data: Buffer) => {
                    emitOut(stderrDec.push(data), true);
                });
            }

            if (cancellationToken) {
                const cancellationListener = cancellationToken.onCancellationRequested(() => {
                    if (this.buildProcess) {
                        this.buildProcess.kill('SIGTERM');
                        this.buildProcess = null;
                    }
                    reject(new Error("Build was cancelled"));
                });
                this.buildProcess.on('close', () => {
                    cancellationListener.dispose();
                });
            }

            this.buildProcess.on('error', (error) => {
                this.buildProcess = null;
                emitOut(stderrDec.end(), true);
                this.manager.output.append(stderr, "error");
                showMsg(MsgType.error, `Failed to assemble ${variantTask}: ${error.message}`);
                reject(error);
            });

            this.buildProcess.on('close', (code) => {
                this.buildProcess = null;
                emitOut(stdoutDec.end(), false);
                emitOut(stderrDec.end(), true);
                if (code === 0) {
                    showMsg(MsgType.info, `${variantTask} assembled successfully.`);
                    resolve();
                } else {
                    this.manager.output.append(stderr, "error");
                    showMsg(MsgType.error, `Failed to assemble ${variantTask}. Exit code: ${code}`);
                    reject(new Error(`Gradle build failed with exit code ${code}`));
                }
            });
        });
    }

    public isBuildInProgress(): boolean {
        return this.buildProcess !== null;
    }

    public cancelBuild(): void {
        if (this.buildProcess) {
            try {
                this.buildProcess.kill('SIGTERM');
            } catch (error) {
                console.error('[GradleService] Error cancelling build:', error);
            }
            this.buildProcess = null;
        }
    }
}
