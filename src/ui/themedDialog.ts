/**
 * Themed confirm/alert dialogs via WebviewPanel.
 *
 * Native `showWarningMessage({ modal: true })` on Windows often renders as a
 * light OS-style box and does not follow the editor color theme. This helper
 * uses VS Code CSS variables so the dialog matches light/dark/high-contrast.
 */

import {
    Uri,
    ViewColumn,
    window,
    type Disposable,
    type WebviewPanel,
} from 'vscode';

let extensionUri: Uri | undefined;

/** Call once from `activate` so dialogs can resolve webview roots. */
export function setDialogExtensionUri(uri: Uri): void {
    extensionUri = uri;
}

export interface ThemedDialogDetail {
    label: string;
    value: string;
}

export interface ThemedConfirmOptions {
    /** Window / panel title */
    title?: string;
    /** Large heading */
    heading: string;
    /** Supporting explanation */
    message: string;
    /** Optional code chip (e.g. INSTALL_FAILED_…) */
    code?: string;
    /** Key/value rows under the message */
    details?: ThemedDialogDetail[];
    /** Question / call to action line */
    prompt?: string;
    primaryLabel: string;
    secondaryLabel?: string;
    /** warning | error | info — affects accent color */
    severity?: 'warning' | 'error' | 'info';
}

export type ThemedDialogResult = 'primary' | 'secondary' | undefined;

function severityAccent(severity: ThemedConfirmOptions['severity']): string {
    switch (severity) {
        case 'error':
            return 'var(--vscode-errorForeground, #f14c4c)';
        case 'info':
            return 'var(--vscode-textLink-foreground, #3794ff)';
        case 'warning':
        default:
            return 'var(--vscode-editorWarning-foreground, #cca700)';
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildHtml(opts: ThemedConfirmOptions): string {
    const accent = severityAccent(opts.severity ?? 'warning');
    const detailsHtml = (opts.details ?? [])
        .map(
            (d) => `
      <div class="row">
        <span class="label">${escapeHtml(d.label)}</span>
        <code class="value">${escapeHtml(d.value)}</code>
      </div>`,
        )
        .join('');

    const codeHtml = opts.code
        ? `<div class="code-chip">${escapeHtml(opts.code)}</div>`
        : '';
    const promptHtml = opts.prompt
        ? `<p class="prompt">${escapeHtml(opts.prompt)}</p>`
        : '';
    const secondaryHtml = opts.secondaryLabel
        ? `<button type="button" class="btn secondary" id="btn-secondary">${escapeHtml(opts.secondaryLabel)}</button>`
        : '';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  :root {
    color-scheme: light dark;
  }
  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
  }
  .shell {
    box-sizing: border-box;
    min-height: 100%;
    display: flex;
    flex-direction: column;
    padding: 20px 22px 16px;
  }
  .header {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }
  .icon {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 16px;
    color: var(--vscode-editor-background);
    background: ${accent};
    line-height: 1;
    margin-top: 2px;
  }
  .content { flex: 1; min-width: 0; }
  h1 {
    margin: 0 0 10px;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.35;
  }
  .message {
    margin: 0 0 12px;
    color: var(--vscode-descriptionForeground);
    line-height: 1.5;
  }
  .code-chip {
    display: inline-block;
    margin: 0 0 12px;
    padding: 3px 8px;
    border-radius: 4px;
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    font-size: 12px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border: 1px solid var(--vscode-panel-border, transparent);
  }
  .details {
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--vscode-textBlockQuote-background, var(--vscode-sideBar-background));
    border: 1px solid var(--vscode-panel-border, transparent);
  }
  .row {
    display: grid;
    grid-template-columns: 72px 1fr;
    gap: 8px;
    align-items: baseline;
    margin: 0 0 6px;
  }
  .row:last-child { margin-bottom: 0; }
  .label {
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }
  .value {
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    font-size: 12px;
    word-break: break-all;
    background: transparent;
    color: var(--vscode-foreground);
  }
  .prompt {
    margin: 0;
    font-weight: 500;
    line-height: 1.45;
  }
  .footer {
    margin-top: auto;
    padding-top: 18px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    border-top: 1px solid var(--vscode-panel-border, transparent);
  }
  .btn {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 2px;
    padding: 6px 14px;
    font: inherit;
    cursor: pointer;
  }
  .btn.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn.primary:hover {
    background: var(--vscode-button-hoverBackground);
  }
  .btn.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  .btn:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }
</style>
</head>
<body>
  <div class="shell">
    <div class="header">
      <div class="icon" aria-hidden="true">!</div>
      <div class="content">
        <h1>${escapeHtml(opts.heading)}</h1>
        <p class="message">${escapeHtml(opts.message)}</p>
        ${codeHtml}
        ${detailsHtml ? `<div class="details">${detailsHtml}</div>` : ''}
        ${promptHtml}
      </div>
    </div>
    <div class="footer">
      ${secondaryHtml}
      <button type="button" class="btn primary" id="btn-primary">${escapeHtml(opts.primaryLabel)}</button>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('btn-primary')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'primary' });
    });
    document.getElementById('btn-secondary')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'secondary' });
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') vscode.postMessage({ type: 'secondary' });
      if (e.key === 'Enter') vscode.postMessage({ type: 'primary' });
    });
  </script>
</body>
</html>`;
}

/**
 * Show a theme-following confirm dialog. Resolves `primary` / `secondary` / undefined (closed).
 */
export function showThemedConfirm(opts: ThemedConfirmOptions): Promise<ThemedDialogResult> {
    const uri = extensionUri;
    if (!uri) {
        // Fallback if activate forgot to set uri — still usable, just no local resources
        console.warn('[themedDialog] extensionUri not set; dialog still works without local assets');
    }

    return new Promise((resolve) => {
        const panel: WebviewPanel = window.createWebviewPanel(
            'androidStudioLite.themedDialog',
            opts.title || 'Android Studio Lite',
            { viewColumn: ViewColumn.Active, preserveFocus: false },
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                localResourceRoots: uri ? [uri] : [],
            },
        );

        let settled = false;
        const finish = (result: ThemedDialogResult) => {
            if (settled) return;
            settled = true;
            try {
                panel.dispose();
            } catch {
                /* ignore */
            }
            resolve(result);
        };

        panel.webview.html = buildHtml(opts);

        const disposables: Disposable[] = [];
        disposables.push(
            panel.webview.onDidReceiveMessage((msg: { type?: string }) => {
                if (msg?.type === 'primary') finish('primary');
                else if (msg?.type === 'secondary') finish('secondary');
            }),
            panel.onDidDispose(() => {
                disposables.forEach((d) => d.dispose());
                finish(undefined);
            }),
        );
    });
}

/** Theme-following alert (single primary button). */
export async function showThemedAlert(
    opts: Omit<ThemedConfirmOptions, 'primaryLabel' | 'secondaryLabel'> & { primaryLabel?: string },
): Promise<void> {
    await showThemedConfirm({
        ...opts,
        primaryLabel: opts.primaryLabel || '知道了',
        secondaryLabel: undefined,
    });
}
