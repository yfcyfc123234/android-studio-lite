import { css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { ASlElement } from '../shared/components/element.js';
import { elementBase } from '../shared/components/styles/base.css.js';
import '../shared/components/dropdown.js';
import '../shared/components/button.js';
import '../shared/components/toggle-button.js';
import type { DropdownOption } from '../shared/components/dropdown.js';

const playIcon = `<svg width="11" height="13" viewBox="0 0 11 13" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M0 11.2354V1.06934C0 0.703125 0.090332 0.43457 0.270996 0.263672C0.45166 0.0878906 0.666504 0 0.915527 0C1.13525 0 1.35986 0.0634766 1.58936 0.19043L10.1221 5.17822C10.4248 5.354 10.6348 5.5127 10.752 5.6543C10.874 5.79102 10.9351 5.95703 10.9351 6.15234C10.9351 6.34277 10.874 6.50879 10.752 6.65039C10.6348 6.79199 10.4248 6.95068 10.1221 7.12646L1.58936 12.1143C1.35986 12.2412 1.13525 12.3047 0.915527 12.3047C0.666504 12.3047 0.45166 12.2168 0.270996 12.041C0.090332 11.8652 0 11.5967 0 11.2354Z" fill="white"/>
</svg>`;

const progressSpinnerIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="spinner-icon">
<rect x="7" width="2" height="5" rx="1" fill="white" fill-opacity="0.8"/>
<rect x="12.9497" y="1.63604" width="2" height="5" rx="1" transform="rotate(45 12.9497 1.63604)" fill="white" fill-opacity="0.1"/>
<rect x="16" y="7" width="2" height="5" rx="1" transform="rotate(90 16 7)" fill="white" fill-opacity="0.2"/>
<rect x="14.364" y="12.9497" width="2" height="5" rx="1" transform="rotate(135 14.364 12.9497)" fill="white" fill-opacity="0.3"/>
<rect x="9" y="16" width="2" height="5" rx="1" transform="rotate(180 9 16)" fill="white" fill-opacity="0.4"/>
<rect x="3.05029" y="14.364" width="2" height="5" rx="1" transform="rotate(-135 3.05029 14.364)" fill="white" fill-opacity="0.5"/>
<rect y="9" width="2" height="5" rx="1" transform="rotate(-90 0 9)" fill="white" fill-opacity="0.6"/>
<rect x="1.63599" y="3.05025" width="2" height="5" rx="1" transform="rotate(-45 1.63599 3.05025)" fill="white" fill-opacity="0.7"/>
</svg>`;

/** Codicon-style refresh (uses currentColor for light/dark). */
const refreshIcon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M13.6569 2.34315C12.1566 0.842855 10.1421 0 8 0C3.58172 0 0 3.58172 0 8H1.5C1.5 4.41015 4.41015 1.5 8 1.5C9.65685 1.5 11.1566 2.17157 12.2426 3.25736L10.5 5H14.5V1L13.6569 2.34315ZM2.34315 13.6569C3.84345 15.1571 5.85786 16 8 16C12.4183 16 16 12.4183 16 8H14.5C14.5 11.5899 11.5899 14.5 8 14.5C6.34315 14.5 4.84345 13.8284 3.75736 12.7426L5.5 11H1.5V15L2.34315 13.6569Z"/>
</svg>`;

/** Unified run target: online device (physical/emulator) or local AVD. */
export interface RunTarget {
    /** physical:<serial> | emulator:<serial> | avd:<name> */
    id: string;
    kind: 'physical' | 'emulator' | 'avd';
    label: string;
    serial?: string;
    avdName?: string;
}

interface Module {
    module: string;
    type: string;
    variants?: any[];
}

@customElement('asl-avd-selector-app')
export class ASlAVDSelectorApp extends ASlElement {
    static override styles = [
        elementBase,
        css`
			:host {
				display: block;
				width: 100%;
				padding: 0.75rem;
				font-family: var(--vscode-font-family);
				font-size: var(--vscode-font-size);
				color: var(--vscode-foreground);
				background-color: var(--vscode-sideBar-background);
			}

			.container {
				display: flex;
				flex-direction: column;
				gap: 0.75rem;
			}

			.section-title {
				font-size: 0.875rem;
				font-weight: 600;
				color: var(--vscode-foreground);
				margin: 0;
				text-transform: uppercase;
				letter-spacing: 0.5px;
			}

			.dropdown-container {
				width: 100%;
			}

			.dropdown-label {
				font-size: 0.75rem;
				font-weight: 500;
				color: var(--vscode-descriptionForeground);
				margin-bottom: 0;
			}

			.dropdown-label-row {
				display: flex;
				align-items: center;
				justify-content: flex-start;
				gap: 0.25rem;
				margin-bottom: 0.25rem;
			}

			.refresh-btn {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 22px;
				height: 22px;
				padding: 0;
				border: none;
				border-radius: 4px;
				cursor: pointer;
				color: var(--vscode-icon-foreground, var(--vscode-foreground));
				background: transparent;
			}

			.refresh-btn:hover:not(:disabled) {
				background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
			}

			.refresh-btn:disabled {
				cursor: default;
				opacity: 0.5;
			}

			.refresh-btn.spinning svg {
				animation: spin 0.8s linear infinite;
			}

			@keyframes spin {
				to {
					transform: rotate(360deg);
				}
			}

			.button-group {
				display: flex;
				gap: 0.5rem;
				width: 100%;
				margin-top: 0.5rem;
			}

			.button-group asl-button {
				flex: 1;
			}

			.button-group asl-toggle-button {
				flex: 0 0 auto;
			}

			.open-project-placeholder {
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				gap: 1rem;
				padding: 1.5rem;
				text-align: center;
				color: var(--vscode-descriptionForeground);
				min-height: 120px;
			}

			.open-project-placeholder .message {
				font-size: var(--vscode-font-size);
				margin: 0;
			}

			.open-project-placeholder asl-button {
				min-width: 180px;
			}
		`,
    ];

    @state()
    private targets: RunTarget[] = [];

    @state()
    private selectedTargetId: string = '';

    @state()
    private modules: Module[] = [];

    @state()
    private selectedModule: string = '';

    @state()
    private isBuilding: boolean = false;

    @state()
    private buildCancellable: boolean = false;

    @state()
    private logcatActive: boolean = false;

    @state()
    private logcatAvailable: boolean = false;

    @state()
    private isAndroidProject: boolean = true;

    @state()
    private refreshingTargets: boolean = false;

    @state()
    private refreshingModules: boolean = false;

    private vscode: any;
    private buildCancellationToken: string | null = null;

    private get targetOptions(): DropdownOption[] {
        return this.targets.map(t => ({
            value: t.id,
            label: t.label,
            target: t,
        }));
    }

    private get moduleOptions(): DropdownOption[] {
        return this.modules.map(module => ({
            value: module.module,
            label: module.module,
            module,
        }));
    }

    /** Run only when a real device/emulator/AVD and an application module are selected. */
    private get canRun(): boolean {
        if (this.isBuilding || !this.selectedModule) {
            return false;
        }
        const target = this.targets.find(t => t.id === this.selectedTargetId);
        if (!target) {
            return false;
        }
        if (target.kind === 'physical' || target.kind === 'emulator') {
            return Boolean(target.serial);
        }
        if (target.kind === 'avd') {
            return Boolean(target.avdName);
        }
        return false;
    }

    private applyTargets(targets: RunTarget[], preferredId?: string) {
        this.targets = targets || [];
        // Keep the user's current selection across refreshes when it is still valid.
        if (this.selectedTargetId && this.targets.some(t => t.id === this.selectedTargetId)) {
            return;
        }
        if (preferredId && this.targets.some(t => t.id === preferredId)) {
            this.selectedTargetId = preferredId;
            return;
        }
        if (this.targets.length === 0) {
            this.selectedTargetId = '';
            return;
        }
        const physical = this.targets.find(t => t.kind === 'physical');
        const emulator = this.targets.find(t => t.kind === 'emulator');
        this.selectedTargetId = physical?.id || emulator?.id || this.targets[0]?.id || '';
    }

    private handleTargetChange(e: CustomEvent) {
        const { value } = e.detail;
        if (value !== this.selectedTargetId) {
            this.selectedTargetId = value;
            if (this.vscode) {
                this.vscode.postMessage({
                    type: 'select-target',
                    params: { targetId: value },
                });
            }
        }
    }

    private handleModuleChange(e: CustomEvent) {
        const { value } = e.detail;
        if (value !== this.selectedModule) {
            this.selectedModule = value;
            if (this.vscode) {
                this.vscode.postMessage({
                    type: 'select-module',
                    params: { moduleName: value },
                });
            }
        }
    }

    private handleRunClick() {
        if (!this.canRun) {
            return;
        }

        const target = this.targets.find(t => t.id === this.selectedTargetId);
        if (!target) {
            return;
        }

        if (this.vscode) {
            this.isBuilding = true;
            this.buildCancellable = true;
            this.buildCancellationToken = `cancel-${Date.now()}`;

            this.vscode.postMessage({
                type: 'run-app',
                params: {
                    targetId: target.id,
                    kind: target.kind,
                    serial: target.serial,
                    avdName: target.avdName,
                    moduleName: this.selectedModule,
                    cancellationToken: this.buildCancellationToken,
                },
            });
        }
    }

    private handleCancelClick() {
        if (!this.buildCancellable || !this.buildCancellationToken) {
            return;
        }

        if (this.vscode) {
            this.vscode.postMessage({
                type: 'cancel-build',
                params: {
                    cancellationToken: this.buildCancellationToken,
                },
            });
        }
    }

    private handleLogcatToggle(e: CustomEvent) {
        const { checked } = e.detail;
        this.logcatActive = checked;

        if (this.vscode) {
            this.vscode.postMessage({
                type: 'toggle-logcat',
                params: { active: checked },
            });
        }
    }

    private handleScreenshotClick() {
        if (!this.vscode) {
            return;
        }
        const target = this.targets.find(t => t.id === this.selectedTargetId);
        this.vscode.postMessage({
            type: 'take-screenshot',
            params: { serial: target?.serial },
        });
    }

    private handleRefreshTargetsClick() {
        if (!this.vscode || this.refreshingTargets) {
            return;
        }
        this.refreshingTargets = true;
        this.vscode.postMessage({ type: 'refresh-targets' });
    }

    private handleRefreshModulesClick() {
        if (!this.vscode || this.refreshingModules) {
            return;
        }
        this.refreshingModules = true;
        this.vscode.postMessage({ type: 'refresh-modules' });
    }

    private handleMessage = (event: MessageEvent) => {
        const message = event.data;
        switch (message.type) {
            case 'update-targets':
                if (Array.isArray(message.params?.targets)) {
                    this.applyTargets(message.params.targets, message.params?.selectedTargetId);
                }
                this.refreshingTargets = false;
                break;
            case 'update-modules':
                const { modules } = message.params || {};
                if (Array.isArray(modules)) {
                    this.modules = modules;
                    if (modules.length === 0) {
                        this.selectedModule = '';
                    } else if (!this.selectedModule || !modules.some((m: Module) => m.module === this.selectedModule)) {
                        this.selectedModule = modules[0].module;
                    }
                }
                this.refreshingModules = false;
                break;
            case 'webview/ready':
                if (message.params && message.params.state) {
                    const state = message.params.state;
                    if (state.targets) {
                        this.applyTargets(state.targets, state.selectedTargetId);
                    }
                    if (state.modules) {
                        this.modules = state.modules;
                        if (state.selectedModule) {
                            this.selectedModule = state.selectedModule;
                        } else if (this.modules.length > 0) {
                            this.selectedModule = this.modules[0].module;
                        }
                    }
                    if (typeof state.logcatAvailable === 'boolean') {
                        this.logcatAvailable = state.logcatAvailable;
                    }
                }
                break;
            case 'build-started':
                this.isBuilding = true;
                this.buildCancellable = true;
                if (message.params?.cancellationToken) {
                    this.buildCancellationToken = message.params.cancellationToken;
                }
                break;
            case 'build-completed':
            case 'build-failed':
            case 'build-cancelled':
                this.isBuilding = false;
                this.buildCancellable = false;
                this.buildCancellationToken = null;
                break;
            case 'logcat-state-changed':
                const { active } = message.params || {};
                if (typeof active === 'boolean') {
                    this.logcatActive = active;
                }
                break;
            case 'update-android-project-state':
                if (typeof message.params?.isAndroidProject === 'boolean') {
                    this.isAndroidProject = message.params.isAndroidProject;
                }
                break;
        }
    };

    private handleOpenFolderClick() {
        if (this.vscode) {
            this.vscode.postMessage({ type: 'open-folder' });
        }
    }

    override connectedCallback() {
        super.connectedCallback();

        if (typeof (window as any).acquireVsCodeApi !== 'undefined') {
            this.vscode = (window as any).acquireVsCodeApi();
        }

        window.addEventListener('message', this.handleMessage);

        if (this.vscode) {
            this.vscode.postMessage({ type: 'refresh-targets' });
            this.vscode.postMessage({ type: 'refresh-modules' });
        }

        if (typeof (window as any).bootstrap !== 'undefined') {
            try {
                const bootstrapStr = (window as any).bootstrap;
                const bootstrap = typeof bootstrapStr === 'string'
                    ? JSON.parse(atob(bootstrapStr))
                    : bootstrapStr;
                if (bootstrap?.targets) {
                    this.applyTargets(bootstrap.targets, bootstrap.selectedTargetId);
                }
                if (bootstrap?.modules) {
                    this.modules = bootstrap.modules;
                    if (bootstrap.selectedModule) {
                        this.selectedModule = bootstrap.selectedModule;
                    } else if (this.modules.length > 0) {
                        this.selectedModule = this.modules[0].module;
                    }
                }
                if (typeof bootstrap?.isAndroidProject === 'boolean') {
                    this.isAndroidProject = bootstrap.isAndroidProject;
                }
                if (typeof bootstrap?.logcatAvailable === 'boolean') {
                    this.logcatAvailable = bootstrap.logcatAvailable;
                }
            } catch (e) {
                console.error('Failed to parse bootstrap data:', e);
            }
        }

        if (this.vscode) {
            this.vscode.postMessage({ type: 'webview/ready' });
        }
    }

    override disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('message', this.handleMessage);
    }

    override render() {
        if (!this.isAndroidProject) {
            return html`
				<div class="container">
					<h2 class="section-title">Android Studio Lite</h2>
					<div class="open-project-placeholder">
						<p class="message">Open an Android project to run and debug apps.</p>
						<asl-button
							label="Open Folder"
							variant="primary"
							@button-click=${this.handleOpenFolderClick}
						></asl-button>
					</div>
				</div>
			`;
        }

        return html`
			<div class="container">
				<h2 class="section-title">Android Studio Lite</h2>

				<div class="dropdown-container">
					<div class="dropdown-label-row">
						<div class="dropdown-label">Select Device</div>
						<button
							class="refresh-btn ${this.refreshingTargets ? 'spinning' : ''}"
							title="Refresh devices"
							aria-label="Refresh devices"
							?disabled=${this.refreshingTargets}
							@click=${this.handleRefreshTargetsClick}
						>
							${unsafeHTML(refreshIcon)}
						</button>
					</div>
					<asl-dropdown
						.options=${this.targetOptions}
						.value=${this.selectedTargetId}
						placeholder="No devices / AVDs"
						@change=${this.handleTargetChange}
					></asl-dropdown>
				</div>

				<div class="dropdown-container">
					<div class="dropdown-label-row">
						<div class="dropdown-label">Select Module</div>
						<button
							class="refresh-btn ${this.refreshingModules ? 'spinning' : ''}"
							title="Refresh modules"
							aria-label="Refresh modules"
							?disabled=${this.refreshingModules}
							@click=${this.handleRefreshModulesClick}
						>
							${unsafeHTML(refreshIcon)}
						</button>
					</div>
					<asl-dropdown
						.options=${this.moduleOptions}
						.value=${this.selectedModule}
						placeholder="No modules available"
						@change=${this.handleModuleChange}
					></asl-dropdown>
				</div>

				<div class="button-group">
					<asl-button
						icon=${this.isBuilding ? progressSpinnerIcon : playIcon}
						label=${this.isBuilding ? 'Building...' : 'Run'}
						?disabled=${!this.canRun}
						@button-click=${this.handleRunClick}
					></asl-button>
					<asl-button
						variant="secondary"
						icon="⏹"
						label="Cancel"
						?disabled=${!this.buildCancellable}
						@button-click=${this.handleCancelClick}
					></asl-button>
					<asl-button
						variant="secondary"
						icon="📷"
						label="Shot"
						?disabled=${!this.selectedTargetId}
						@button-click=${this.handleScreenshotClick}
					></asl-button>
					${this.logcatAvailable
						? html`<asl-toggle-button
								label="Logcat"
								?checked=${this.logcatActive}
								@toggle-click=${this.handleLogcatToggle}
							></asl-toggle-button>`
						: ''}
				</div>
			</div>
		`;
    }
}

if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            const app = document.createElement('asl-avd-selector-app');
            document.body.appendChild(app);
        });
    } else {
        const app = document.createElement('asl-avd-selector-app');
        document.body.appendChild(app);
    }
}
