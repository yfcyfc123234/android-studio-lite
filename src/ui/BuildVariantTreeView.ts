import * as vscode from 'vscode';
import { Manager } from '../core';
import { showMsg, showQuickPick, MsgType } from '../module/ui';
import { subscribe } from '../module/';
import { BuildVariantQuickPickItem } from './BuildVariantQuickPick';
import { MuduleBuildVariant } from '../service/BuildVariantService';
import { BuildVariantModel } from '../cmd/BuildVariant';

const SELECTED_BUILD_VARIANTS_KEY = 'android-studio-lite.selectedBuildVariants';

export class BuildVariantTreeView {
    readonly provider: BuildVariantTreeDataProvider;
    private fileWatcher: vscode.FileSystemWatcher | undefined;

    constructor(context: vscode.ExtensionContext, private manager: Manager) {
        this.provider = new BuildVariantTreeDataProvider(this.manager, context);

        const view = vscode.window.createTreeView('android-studio-lite-build-variant', {
            treeDataProvider: this.provider,
            showCollapseAll: true
        });

        // Setup file watcher for build.gradle files
        this.setupFileWatcher(context);

        const subscriptions: vscode.Disposable[] = [
            view,
            vscode.commands.registerCommand('android-studio-lite.buildvariant-refresh', this.refresh),
            vscode.commands.registerCommand('android-studio-lite.openAndroidProject', () => {
                void vscode.commands.executeCommand('workbench.action.files.openFolder');
            }),

            vscode.commands.registerCommand('android-studio-lite.buildvariant-select', async (node) => {
                let moduleName: string | undefined;
                if (node instanceof BuildVariantTreeItem) {
                    moduleName = node.moduleBuildVariant?.module;
                } else if (node?.moduleBuildVariant?.module) {
                    moduleName = node.moduleBuildVariant.module;
                } else if (typeof node === 'string') {
                    moduleName = node;
                }
                await this.selectBuildVariant(moduleName);
            }),
        ];

        // Refresh when workspace folders change (e.g. user opened a folder)
        subscriptions.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.provider.refresh();
            }),
        );

        // Add file watcher to subscriptions if it exists
        if (this.fileWatcher) {
            subscriptions.push(this.fileWatcher);
        }

        subscribe(context, subscriptions);
    }

    private setupFileWatcher(context: vscode.ExtensionContext) {
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspacePath) {
            return;
        }

        // Watch for build.gradle and build.gradle.kts files
        const pattern = new vscode.RelativePattern(
            workspacePath,
            '**/{build.gradle,build.gradle.kts}'
        );

        this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        this.fileWatcher.onDidChange(() => {
            console.log('[BuildVariantTreeView] build.gradle file changed, clearing cache');
            this.manager.buildVariant.clearCache();
            this.provider.refresh();
        });

        this.fileWatcher.onDidCreate(() => {
            console.log('[BuildVariantTreeView] build.gradle file created, clearing cache');
            this.manager.buildVariant.clearCache();
            this.provider.refresh();
        });

        this.fileWatcher.onDidDelete(() => {
            console.log('[BuildVariantTreeView] build.gradle file deleted, clearing cache');
            this.manager.buildVariant.clearCache();
            this.provider.refresh();
        });
    }

    refresh = async () => {
        // Clear cache and refresh the tree view - this will reload modules and variants
        this.manager.buildVariant.clearCache();
        this.provider.refresh();
    };

    async getBuildVariantQuickPickItems(moduleName: string): Promise<BuildVariantQuickPickItem[] | undefined> {
        const modules = await this.manager.buildVariant.getModuleBuildVariants(this.provider.context);
        const module = modules.find(m => m.module === moduleName);

        if (!module || !module.variants || module.variants.length === 0) {
            return undefined;
        }

        return module.variants.map((variant) => new BuildVariantQuickPickItem(variant));
    }

    async selectBuildVariant(moduleName: string | undefined) {
        if (!moduleName) {
            showMsg(MsgType.warning, "No module selected.");
            return;
        }

        const modules = await this.manager.buildVariant.getModuleBuildVariants(this.provider.context);
        const module = modules.find(m => m.module === moduleName);

        if (!module) {
            showMsg(MsgType.warning, `Module ${moduleName} not found.`);
            return;
        }

        const selected = await showQuickPick(
            this.getBuildVariantQuickPickItems(moduleName),
            {
                placeHolder: `Select build variant for ${moduleName}`,
                canPickMany: false
            },
            `No build variants found for ${moduleName}.`,
            "No build variant selected."
        );

        if (selected && typeof selected !== 'boolean') {
            const buildVariant = (selected as BuildVariantQuickPickItem).buildVariant;
            await this.applySelectedBuildVariant(module, buildVariant);
            this.provider.refresh();
        }
    }

    /**
     * Persist the chosen variant. For application modules, also align library
     * modules to a compatible variant (same buildType / best flavor overlap),
     * similar to Android Studio's Build Variants coordination.
     */
    private async applySelectedBuildVariant(
        module: MuduleBuildVariant,
        buildVariant: BuildVariantModel
    ) {
        const context = this.provider.context;
        const selectedVariants = context.workspaceState.get<Record<string, string>>(
            SELECTED_BUILD_VARIANTS_KEY,
            {}
        );
        selectedVariants[module.module] = buildVariant.name;

        let cascaded = 0;
        if (module.type === 'application') {
            const modules = await this.manager.buildVariant.getModuleBuildVariants(context);
            for (const other of modules) {
                if (other.module === module.module || other.type !== 'library') {
                    continue;
                }
                const match = findCompatibleVariant(other, buildVariant);
                if (match && selectedVariants[other.module] !== match.name) {
                    selectedVariants[other.module] = match.name;
                    cascaded++;
                }
            }
        }

        await context.workspaceState.update(SELECTED_BUILD_VARIANTS_KEY, selectedVariants);

        if (cascaded > 0) {
            showMsg(
                MsgType.info,
                `${module.module} → ${buildVariant.name}; aligned ${cascaded} library module(s) to buildType "${buildVariant.buildType}".`
            );
        }
    }

    private async saveSelectedBuildVariant(
        context: vscode.ExtensionContext,
        moduleName: string,
        variantName: string
    ) {
        const selectedVariants = context.workspaceState.get<Record<string, string>>(
            SELECTED_BUILD_VARIANTS_KEY,
            {}
        );
        selectedVariants[moduleName] = variantName;
        await context.workspaceState.update(SELECTED_BUILD_VARIANTS_KEY, selectedVariants);
    }

    getSelectedBuildVariant(context: vscode.ExtensionContext, moduleName: string): string | undefined {
        const selectedVariants = context.workspaceState.get<Record<string, string>>(
            SELECTED_BUILD_VARIANTS_KEY,
            {}
        );
        return selectedVariants[moduleName];
    }
}

/**
 * Pick the best variant on `module` for the selection made on another module
 * (typically an application). Prefer exact name, then same buildType with
 * maximum product-flavor overlap, then buildType-only / name suffix fallbacks.
 */
export function findCompatibleVariant(
    module: MuduleBuildVariant,
    source: BuildVariantModel
): BuildVariantModel | undefined {
    const variants = module.variants;
    if (!variants || variants.length === 0) {
        return undefined;
    }

    const exact = variants.find(v => v.name === source.name);
    if (exact) {
        return exact;
    }

    const sourceBuildType = (source.buildType || '').toLowerCase();
    const sourceFlavors = new Set(
        (source.flavors || [])
            .map(f => (f || '').trim())
            .filter(f => f.length > 0 && f.toLowerCase() !== sourceBuildType)
    );

    const sameBuildType = variants.filter(
        v => (v.buildType || '').toLowerCase() === sourceBuildType
    );

    const scoreVariant = (v: BuildVariantModel): number => {
        let score = 0;
        const flavors = new Set((v.flavors || []).map(f => (f || '').trim()).filter(Boolean));
        for (const f of sourceFlavors) {
            if (flavors.has(f)) {
                score += 10;
            }
        }
        // Prefer plain buildType name (debug/release) for libraries without flavors
        if (v.name.toLowerCase() === sourceBuildType) {
            score += 3;
        }
        if (v.name.toLowerCase().endsWith(sourceBuildType)) {
            score += 1;
        }
        return score;
    };

    if (sameBuildType.length > 0) {
        return sameBuildType.reduce((best, v) =>
            scoreVariant(v) > scoreVariant(best) ? v : best
        );
    }

    return (
        variants.find(v => v.name.toLowerCase() === sourceBuildType) ||
        variants.find(v => v.name.toLowerCase().endsWith(sourceBuildType)) ||
        undefined
    );
}

type TreeItem = BuildVariantTreeItem | OpenAndroidProjectTreeItem;

class BuildVariantTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
    constructor(
        private manager: Manager,
        public readonly context: vscode.ExtensionContext
    ) { }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeItem): Promise<TreeItem[]> {
        if (!this.manager.buildVariant.isAndroidProject()) {
            return [new OpenAndroidProjectTreeItem()];
        }

        try {
            const modules = await this.manager.buildVariant.getModuleBuildVariants(this.context);

            if (!modules || modules.length === 0) {
                return [];
            }

            const selectedVariants = this.context.workspaceState.get<Record<string, string>>(
                SELECTED_BUILD_VARIANTS_KEY,
                {}
            );

            return modules.map((moduleBuildVariant: MuduleBuildVariant) => {
                const selectedVariant = selectedVariants[moduleBuildVariant.module];
                // If no variant is selected, use the first one as default
                const variantName = selectedVariant ||
                    (moduleBuildVariant.variants && moduleBuildVariant.variants.length > 0
                        ? moduleBuildVariant.variants[0].name
                        : "none");

                return new BuildVariantTreeItem(
                    moduleBuildVariant,
                    variantName,
                    vscode.TreeItemCollapsibleState.None
                );
            });
        } catch (error) {
            console.error('Error loading build variants:', error);
            return [];
        }
    }

    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> =
        new vscode.EventEmitter<TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}

/** Shown when workspace is not an Android project; runs Open Folder on click. */
class OpenAndroidProjectTreeItem extends vscode.TreeItem {
    constructor() {
        super('Open an Android project', vscode.TreeItemCollapsibleState.None);
        this.tooltip = 'Open a folder containing an Android project (with gradlew)';
        this.iconPath = new vscode.ThemeIcon('folder-opened');
        this.command = {
            command: 'android-studio-lite.openAndroidProject',
            title: 'Open Folder',
        };
    }
    contextValue = 'openAndroidProject';
}

export class BuildVariantTreeItem extends vscode.TreeItem {
    constructor(
        public readonly moduleBuildVariant: MuduleBuildVariant,
        public readonly selectedVariantName: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(`${moduleBuildVariant.module} | ${selectedVariantName}`, collapsibleState);

        this.description = moduleBuildVariant.type;

        const selectedVariant = moduleBuildVariant.variants?.find(
            v => v.name === selectedVariantName
        );

        let tooltip = `Module: ${moduleBuildVariant.module}\n`;
        tooltip += `Type: ${moduleBuildVariant.type}\n`;
        tooltip += `Selected Variant: ${selectedVariantName}\n`;

        if (selectedVariant) {
            tooltip += `Build Type: ${selectedVariant.buildType}\n`;
            if (selectedVariant.flavors && selectedVariant.flavors.length > 0) {
                tooltip += `Flavors: ${selectedVariant.flavors[0]}\n`;
            }
        }

        this.tooltip = tooltip;
        this.command = {
            command: 'android-studio-lite.buildvariant-select',
            title: 'Select Build Variant',
            arguments: [this]
        };
    }

    contextValue = "buildVariant";
    iconPath = new vscode.ThemeIcon('package');
}
