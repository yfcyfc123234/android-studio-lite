/**
 * Themed confirm/alert dialogs via WebviewPanel.
 *
 * VS Code/Cursor has no API for a true floating, theme-aware OS modal from
 * extensions. Native `showWarningMessage({ modal: true })` is a real popup but
 * on Windows often paints as a light system box and ignores the editor theme.
 *
 * We therefore open a short-lived WebviewPanel and render a centered dialog
 * card on a dimmed backdrop so it reads as a modal while still using
 * `--vscode-*` colors. The editor tab chrome is a platform limit, not styling.
 *
 * Text is selectable; error code / detail values / full summary support one-click copy.
 */

import {
    Uri,
    ViewColumn,
    env,
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

/** Attr-safe payload for data-copy (still HTML-escaped). */
function escapeAttr(text: string): string {
    return escapeHtml(text).replace(/'/g, '&#39;');
}

function buildCopySummary(opts: ThemedConfirmOptions): string {
    const lines = [opts.heading, opts.message];
    if (opts.code) {
        lines.push(opts.code);
    }
    for (const d of opts.details ?? []) {
        lines.push(`${d.label}: ${d.value}`);
    }
    if (opts.prompt) {
        lines.push(opts.prompt);
    }
    return lines.filter(Boolean).join('\n');
}

function buildHtml(opts: ThemedConfirmOptions): string {
    const accent = severityAccent(opts.severity ?? 'warning');
    const detailsHtml = (opts.details ?? [])
        .map(
            (d, i) => `
      <div class="row">
        <span class="label">${escapeHtml(d.label)}</span>
        <div class="value-wrap">
          <code class="value copyable" data-copy="${escapeAttr(d.value)}" title="Click to copy">${escapeHtml(d.value)}</code>
          <button type="button" class="btn-copy" data-copy="${escapeAttr(d.value)}" data-hint="detail-${i}" title="Copy">Copy</button>
        </div>
      </div>`,
        )
        .join('');

    const codeHtml = opts.code
        ? `<div class="code-row">
        <button type="button" class="code-chip copyable" data-copy="${escapeAttr(opts.code)}" title="Click to copy">${escapeHtml(opts.code)}</button>
        <button type="button" class="btn-copy" data-copy="${escapeAttr(opts.code)}" title="Copy error code">Copy</button>
      </div>`
        : '';
    const promptHtml = opts.prompt
        ? `<p class="prompt">${escapeHtml(opts.prompt)}</p>`
        : '';
    const secondaryHtml = opts.secondaryLabel
        ? `<button type="button" class="btn secondary" id="btn-secondary">${escapeHtml(opts.secondaryLabel)}</button>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
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
    background: transparent;
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    user-select: text;
    -webkit-user-select: text;
  }
  /* Dimmed stage — closest we can get to a floating modal inside a webview tab */
  .backdrop {
    box-sizing: border-box;
    min-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 28px 20px;
    background: color-mix(in srgb, var(--vscode-editor-background) 55%, #000 45%);
  }
  @supports not (background: color-mix(in srgb, #000 50%, #fff 50%)) {
    .backdrop {
      background: rgba(0, 0, 0, 0.45);
    }
  }
  .dialog {
    box-sizing: border-box;
    width: min(480px, 100%);
    max-height: calc(100vh - 56px);
    display: flex;
    flex-direction: column;
    padding: 18px 18px 14px;
    border-radius: 8px;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, transparent));
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--vscode-widget-shadow, #000) 20%, transparent),
      0 12px 40px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.45));
    overflow: auto;
  }
  .header {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .icon {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 15px;
    color: var(--vscode-editor-background);
    background: ${accent};
    line-height: 1;
    margin-top: 1px;
    user-select: none;
  }
  .content { flex: 1; min-width: 0; }
  h1 {
    margin: 0 0 8px;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.35;
  }
  .message {
    margin: 0 0 10px;
    color: var(--vscode-descriptionForeground);
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .code-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 10px;
    flex-wrap: wrap;
  }
  .code-chip {
    appearance: none;
    display: inline-block;
    margin: 0;
    padding: 3px 8px;
    border-radius: 4px;
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    font-size: 12px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border: 1px solid var(--vscode-panel-border, transparent);
    cursor: pointer;
  }
  .code-chip:hover {
    filter: brightness(1.08);
  }
  .details {
    margin: 0 0 12px;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--vscode-textBlockQuote-background, var(--vscode-sideBar-background));
    border: 1px solid var(--vscode-panel-border, transparent);
  }
  .row {
    display: grid;
    grid-template-columns: 88px 1fr;
    gap: 8px;
    align-items: center;
    margin: 0 0 6px;
  }
  .row:last-child { margin-bottom: 0; }
  .label {
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }
  .value-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .value {
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    font-size: 12px;
    word-break: break-all;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
  }
  .value:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .btn-copy {
    appearance: none;
    flex: 0 0 auto;
    border: 1px solid var(--vscode-button-secondaryBackground, var(--vscode-panel-border));
    border-radius: 2px;
    padding: 2px 8px;
    font-size: 11px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    cursor: pointer;
    user-select: none;
  }
  .btn-copy:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  .btn-copy.copied {
    border-color: var(--vscode-textLink-foreground, #3794ff);
    color: var(--vscode-textLink-foreground, #3794ff);
  }
  .prompt {
    margin: 0;
    font-weight: 500;
    line-height: 1.45;
  }
  .toast {
    position: fixed;
    right: 16px;
    bottom: 16px;
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 12px;
    background: var(--vscode-notifications-background, var(--vscode-editorWidget-background));
    color: var(--vscode-notifications-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-notifications-border, var(--vscode-panel-border));
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
    user-select: none;
    z-index: 2;
  }
  .toast.show { opacity: 1; }
  .footer {
    margin-top: 14px;
    padding-top: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    border-top: 1px solid var(--vscode-panel-border, transparent);
    user-select: none;
  }
  .footer-left, .footer-right {
    display: flex;
    gap: 8px;
    align-items: center;
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
  <div class="backdrop" id="backdrop">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div class="header">
        <div class="icon" aria-hidden="true">!</div>
        <div class="content">
          <h1 id="dialog-title">${escapeHtml(opts.heading)}</h1>
          <p class="message">${escapeHtml(opts.message)}</p>
          ${codeHtml}
          ${detailsHtml ? `<div class="details">${detailsHtml}</div>` : ''}
          ${promptHtml}
        </div>
      </div>
      <div class="footer">
        <div class="footer-left">
          <button type="button" class="btn secondary" id="btn-copy-all" title="Copy heading, message, code, and details">Copy all</button>
        </div>
        <div class="footer-right">
          ${secondaryHtml}
          <button type="button" class="btn primary" id="btn-primary">${escapeHtml(opts.primaryLabel)}</button>
        </div>
      </div>
    </div>
  </div>
  <div class="toast" id="toast">Copied</div>
  <script>
    const vscode = acquireVsCodeApi();
    const toast = document.getElementById('toast');
    let toastTimer;

    function flashCopied(el) {
      if (!el) return;
      el.classList.add('copied');
      if (el.tagName === 'BUTTON' && el.classList.contains('btn-copy')) {
        const prev = el.textContent;
        el.textContent = 'Copied';
        setTimeout(() => {
          el.classList.remove('copied');
          el.textContent = prev;
        }, 900);
      } else {
        setTimeout(() => el.classList.remove('copied'), 900);
      }
      if (toast) {
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 900);
      }
    }

    function requestCopy(text, el) {
      if (!text) return;
      vscode.postMessage({ type: 'copy', text });
      flashCopied(el);
    }

    document.getElementById('btn-primary')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'primary' });
    });
    document.getElementById('btn-secondary')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'secondary' });
    });
    document.getElementById('btn-copy-all')?.addEventListener('click', (e) => {
      vscode.postMessage({ type: 'copy-all' });
      flashCopied(e.currentTarget);
    });
    // Click dimmed area (not the card) → Cancel, like a modal backdrop
    document.getElementById('backdrop')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        vscode.postMessage({ type: 'secondary' });
      }
    });

    document.querySelectorAll('[data-copy]').forEach((el) => {
      el.addEventListener('click', (e) => {
        // Avoid double-fire when clicking the small Copy button inside a wrap
        e.stopPropagation();
        const text = el.getAttribute('data-copy') || '';
        requestCopy(text, el);
      });
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        vscode.postMessage({ type: 'secondary' });
        return;
      }
      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
        return;
      }
      // Do not confirm while focus is on Copy / secondary / other controls
      const active = document.activeElement;
      const primary = document.getElementById('btn-primary');
      if (active && primary && active !== primary) {
        const tag = (active.tagName || '').toLowerCase();
        if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'textarea' || tag === 'select') {
          return;
        }
        if (active.classList?.contains('copyable') || active.classList?.contains('btn-copy')) {
          return;
        }
      }
      vscode.postMessage({ type: 'primary' });
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
        console.warn('[themedDialog] extensionUri not set; dialog still works without local assets');
    }

    const fullCopyText = buildCopySummary(opts);

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
            panel.webview.onDidReceiveMessage(async (msg: { type?: string; text?: string }) => {
                if (msg?.type === 'primary') {
                    finish('primary');
                    return;
                }
                if (msg?.type === 'secondary') {
                    finish('secondary');
                    return;
                }
                if (msg?.type === 'copy' && typeof msg.text === 'string') {
                    await env.clipboard.writeText(msg.text);
                    return;
                }
                if (msg?.type === 'copy-all') {
                    await env.clipboard.writeText(fullCopyText);
                }
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
        primaryLabel: opts.primaryLabel || 'OK',
        secondaryLabel: undefined,
    });
}
