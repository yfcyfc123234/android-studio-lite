import {
    MessageOptions, window, QuickPickOptions, QuickPickItem, OutputChannel
} from 'vscode';

export enum MsgType {
    info, warning, error
}

export function showMsg(type: MsgType, message: string, options: MessageOptions = {}, ...items: string[]) {
    switch (type) {
        case MsgType.error:
            return window.showErrorMessage(message, options, ...items);
        case MsgType.warning:
            return window.showWarningMessage(message, options, ...items);
    }
    return window.showInformationMessage(message, options, ...items);
}

export function showYesNoMsg(type: MsgType, message: string, options: MessageOptions = {}) {
    return showMsg(type, message, options, "Yes", "No");
}
export function showYesNoCancelMsg(type: MsgType, message: string, options: MessageOptions = {}) {
    return showMsg(type, message, options, "Yes", "No", "Cancel");
}
export function showOkCancelMsg(type: MsgType, message: string, options: MessageOptions = {}) {
    return showMsg(type, message, options, "OK", "Cancel");
}

export async function showTargetOfSettingsSelectionMsg() {
    return showMsg(MsgType.info, "Which target of settings do you what to update?", {},
        "Global", "Workspace (Folder)", "Both", "Cancel");
}

export async function showQuickPick(
    items: Promise<QuickPickItem[] | undefined>,
    quickPickOption: QuickPickOptions,
    msglistEmpty: string,
    msgNotSelected: string = ""): Promise<QuickPickItem | boolean> {

    // get available AVDs
    const list: QuickPickItem[] | undefined = await items;
    if (!list || list.length < 1) {
        showMsg(MsgType.info, msglistEmpty);
        return false;
    }

    // get AVD
    const item: QuickPickItem | undefined = await window.showQuickPick(list, quickPickOption);
    if (!item) {
        if (msgNotSelected !== "") {
            showMsg(MsgType.info, msgNotSelected);
        }
        return false;
    }

    return item;
}

export async function showYesNoQuickPick(placeHolder: string) {
    return await window.showQuickPick(["Yes", "No"], {
        placeHolder: placeHolder,
        canPickMany: false
    });
}

export class Output {
    private output: OutputChannel;
    constructor(name: string) {
        this.output = window.createOutputChannel(name);
    }
    /**
     * Append text to the Output channel.
     * Streaming process chunks must not force a newline per chunk (that splits words
     * like "UP-TO-DATE" / "reachable" across lines). One-shot messages without `\n`
     * still get a trailing newline via appendLine.
     */
    public append(msg: string, level: string = "info") {
        if (msg === "") {
            return;
        }

        if (level === "error") {
            // Prefer line-wise [ERR] prefix for multi-line blobs; single chunk streams use raw append
            if (msg.includes("\n") || msg.includes("\r")) {
                const parts = msg.split(/\r?\n/);
                for (let i = 0; i < parts.length; i++) {
                    const line = parts[i];
                    if (i === parts.length - 1 && line === "") {
                        break;
                    }
                    this.output.appendLine("[ERR] " + line);
                }
            } else {
                this.output.appendLine("[ERR] " + msg);
            }
            return;
        }

        if (msg.includes("\n") || msg.includes("\r")) {
            this.output.append(msg);
        } else {
            this.output.appendLine(msg);
        }
    }

    /** Raw stream append (no forced newline, no [ERR] prefix). */
    public appendStream(msg: string) {
        if (msg) {
            this.output.append(msg);
        }
    }

    public appendTime() {
        let current = new Date();
        this.output.appendLine("\nCurrent: " + current + "\n");
    }
    public clear() {
        this.output.clear();
    }

    public show() {
        this.output.show(true);
    }
    public hide() {
        this.output.hide();
    }
}
