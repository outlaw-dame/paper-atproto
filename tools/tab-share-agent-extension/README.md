# Tab Share With Agent (VS Code Extension)

Adds an icon to each editor tab so you can quickly share the active tab context with an agent.

## What it does

- Adds two tab title icons:
   - "Share Full File With Agent"
   - "Share Selection With Agent"
- Captures current file path, language, and either full file content or selected text
- Copies a ready-to-paste prompt to clipboard
- Opens Chat view (best effort)

## Use

1. Install dependencies:
   - `npm install`
2. Build:
   - `npm run build`
3. Launch extension development host:
   - Press F5 in this extension folder
4. Open any file tab and click the tab icon (speech bubble)
5. Paste into chat if it is not prefilled automatically

## Settings

- `tabShareWithAgent.maxContentChars`
   - Default: `12000`
   - Minimum: `500`
   - Controls how much content is included before truncation

- `tabShareWithAgent.autoOpenChat`
   - Default: `true`
   - If `false`, the extension only copies to clipboard and does not open Chat automatically

## Notes

- If text is very large, content is truncated to keep prompts manageable.
- "Share Selection With Agent" requires an active selection.
