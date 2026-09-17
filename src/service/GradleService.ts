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
import { spawnGradleWrapper } from '../utils/gradleSpawn';

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

        // Spawn Gradle wrapper (Windows uses cmd /c for .bat; task stays a separate argv).
        const runGradleTask = (
            taskPath: string,
            spawnEnv: NodeJS.ProcessEnv,
        ): Promise<{ stdout: string; stderr: string }> =>
            new Promise((resolve, reject) => {
                if (cancellationToken?.isCancellationRequested) {
                    reject(new Error("Build was cancelled"));
                    return;
                }

                // Windows: cmd.exe /c gradlew.bat <task> (CVE-2024-27980 — cannot spawn .bat with shell:false)
                const spawnOptions: child_process.SpawnOptions = {
                    cwd: this.workspacePath,
                    env: spawnEnv,
                    windowsHide: true,
                };

                this.buildProcess = spawnGradleWrapper(gradlewPath, [taskPath], spawnOptions);

                let stdout = '';
                let stderr = '';
                const stdoutDec = new StreamingProcessDecoder();
                const stderrDec = new StreamingProcessDecoder();

                const emitOut = (text: string, _isErr: boolean) => {
                    if (!text) {
                        return;
                    }
                    // Gradle writes progress to both stdout and stderr; JVM also prints
                    // "Picked up JAVA_TOOL_OPTIONS" on stderr. Do not tag every stderr
                    // chunk as [ERR] — that produced fake "[ERR] -8" when "UTF-8" split.
                    if (_isErr) {
                        stderr += text;
                    } else {
                        stdout += text;
                    }
                    onOutput?.(text);
                    this.manager.output.appendStream(text);
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
                    // Windows cmd quirks can report a bogus non-zero code after success
                    const ok =
                        code === 0 ||
                        /\bBUILD SUCCESSFUL\b/.test(stdout) ||
                        /\bBUILD SUCCESSFUL\b/.test(stderr);
                    if (ok) {
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
            console.error(`[GradleService] Build failed for ${variantTask}:`, error);
            if (notifyOnFailure) {
                const raw = String(error?.message || error);
                showMsg(MsgType.error, `Failed to install ${variantTask}: ${raw}`);
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
                cwd: this.workspacePath,
                env: withJavaUtf8ProcessEnv(process.env),
                windowsHide: true,
            };

            this.buildProcess = spawnGradleWrapper(gradlewPath, [variantTask], spawnOptions);

            let stdout = '';
            let stderr = '';
            const stdoutDec = new StreamingProcessDecoder();
            const stderrDec = new StreamingProcessDecoder();

            const emitOut = (text: string, _isErr: boolean) => {
                if (!text) {
                    return;
                }
                if (_isErr) {
                    stderr += text;
                } else {
                    stdout += text;
                }
                onOutput?.(text);
                this.manager.output.appendStream(text);
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
                showMsg(MsgType.error, `Failed to assemble ${variantTask}: ${error.message}`);
                reject(error);
            });

            this.buildProcess.on('close', (code) => {
                this.buildProcess = null;
                emitOut(stdoutDec.end(), false);
                emitOut(stderrDec.end(), true);
                const ok =
                    code === 0 ||
                    /\bBUILD SUCCESSFUL\b/.test(stdout) ||
                    /\bBUILD SUCCESSFUL\b/.test(stderr);
                if (ok) {
                    showMsg(MsgType.info, `${variantTask} assembled successfully.`);
                    resolve();
                } else {
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
