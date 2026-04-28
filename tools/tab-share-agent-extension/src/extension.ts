import * as vscode from 'vscode';

const DEFAULT_MAX_CONTENT_CHARS = 12000;

type ShareMode = 'full-file' | 'selection-only';

function getMaxContentChars(): number {
  const configured = vscode.workspace.getConfiguration('tabShareWithAgent').get<number>('maxContentChars');

  if (typeof configured !== 'number' || Number.isNaN(configured)) {
    return DEFAULT_MAX_CONTENT_CHARS;
  }

  return Math.max(500, Math.floor(configured));
}

function shouldAutoOpenChat(): boolean {
  return vscode.workspace.getConfiguration('tabShareWithAgent').get<boolean>('autoOpenChat', true);
}

function buildSharePrompt(
  document: vscode.TextDocument,
  selection: vscode.Selection | undefined,
  mode: ShareMode,
  maxContentChars: number
): string {
  const fullText = document.getText();
  const hasSelection = !!selection && !selection.isEmpty;
  const shouldUseSelection = mode === 'selection-only' && hasSelection;
  const selectedText = shouldUseSelection ? document.getText(selection) : '';
  const rawContent = shouldUseSelection ? selectedText : fullText;

  const trimmed = rawContent.length > maxContentChars
    ? `${rawContent.slice(0, maxContentChars)}\n\n[Truncated to ${maxContentChars} characters]`
    : rawContent;

  const selectionLineInfo = shouldUseSelection && selection
    ? `Selection: lines ${selection.start.line + 1}-${selection.end.line + 1}`
    : mode === 'selection-only'
      ? 'Selection: none (selection-only requested, no selection available)'
      : 'Selection: not used (shared full file content)';

  const modeLabel = mode === 'selection-only' ? 'selection only' : 'full file';

  return [
    'Use this tab as context for my request.',
    `Mode: ${modeLabel}`,
    `File: ${document.fileName}`,
    `Language: ${document.languageId}`,
    selectionLineInfo,
    '',
    'Content:',
    '```',
    trimmed,
    '```'
  ].join('\n');
}

async function openChatWithFallback(prompt: string): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
    return;
  } catch {
    // Fall through to basic open command.
  }

  try {
    await vscode.commands.executeCommand('workbench.action.chat.open');
  } catch {
    // If chat cannot be opened, user still has clipboard content.
  }
}

async function resolveEditorForResource(resource?: vscode.Uri): Promise<vscode.TextEditor | undefined> {
  let editor = vscode.window.activeTextEditor;

  if (resource && (!editor || editor.document.uri.toString() !== resource.toString())) {
    const document = await vscode.workspace.openTextDocument(resource);
    await vscode.window.showTextDocument(document, { preview: true, preserveFocus: false });
    editor = vscode.window.activeTextEditor;
  }

  return editor;
}

async function shareFromEditor(resource: vscode.Uri | undefined, mode: ShareMode): Promise<void> {
  const editor = await resolveEditorForResource(resource);

  if (!editor) {
    vscode.window.showWarningMessage('No active editor found to share.');
    return;
  }

  if (mode === 'selection-only' && editor.selection.isEmpty) {
    vscode.window.showWarningMessage('No selection found. Select text first, then try again.');
    return;
  }

  const prompt = buildSharePrompt(editor.document, editor.selection, mode, getMaxContentChars());
  await vscode.env.clipboard.writeText(prompt);

  if (shouldAutoOpenChat()) {
    await openChatWithFallback(prompt);
  }

  const action = await vscode.window.showInformationMessage(
    shouldAutoOpenChat()
      ? 'Tab context copied. Paste into chat to share with your agent.'
      : 'Tab context copied. Auto-open chat is disabled.',
    'Copy Again'
  );

  if (action === 'Copy Again') {
    await vscode.env.clipboard.writeText(prompt);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const shareActiveTab = vscode.commands.registerCommand('tabShareWithAgent.shareActiveTab', async (resource?: vscode.Uri) => {
    await shareFromEditor(resource, 'full-file');
  });

  const shareSelection = vscode.commands.registerCommand('tabShareWithAgent.shareSelection', async (resource?: vscode.Uri) => {
    await shareFromEditor(resource, 'selection-only');
  });

  context.subscriptions.push(shareActiveTab, shareSelection);
}

export function deactivate(): void {
  // No-op
}
