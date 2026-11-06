import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { libraryDocument, settingsDocument } from '../../apps/extension/src/ui/index';
import { copyFor } from '../../apps/extension/src/ui/copy';

const css = readFileSync('apps/extension/src/styles/main.css', 'utf8');

/** Every selector of every rule whose selector list mentions `.tree-row`. */
function treeRowSelectors(): string[] {
  return [...css.matchAll(/^([^{}@/][^{}]*)\{/gm)]
    .flatMap((match) => match[1].split(','))
    .map((selector) => selector.trim())
    .filter((selector) => selector.includes('.tree-row'));
}

describe('folder picker styles stay out of the sidebar tree', () => {
  it('scopes picker-only row states to .folder-tree-list', () => {
    // Both the sidebar and the picker use .tree-row; picker indentation, hover and states must not leak.
    const pickerOnly = /--depth|data-active|is-current|is-context|is-create|aria-level|aria-selected|pick-twisty| mark/;
    for (const selector of treeRowSelectors()) {
      if (pickerOnly.test(selector)) expect(selector.startsWith('.folder-tree-list ')).toBe(true);
    }
    expect(css).not.toMatch(/^\.tree-row \{[^}]*--depth/m);
    expect(css).not.toMatch(/^\.tree-row:hover \{/m);
  });

  it('keeps the selected folder looking selected while hovered', () => {
    expect(css).toContain('.tree-row:hover > .tree-button[aria-pressed="true"]');
  });
});

describe('library on narrow screens', () => {
  const html = libraryDocument([], 'zh');

  it('offers a labelled toggle that controls the sidebar', () => {
    expect(html).toContain('<aside id="side-panel" class="library-side">');
    expect(html).toMatch(/id="side-toggle"[^>]*aria-controls="side-panel"[^>]*aria-expanded="false"/);
    expect(html).toContain(`aria-label="${copyFor('zh').showSidebar}"`);
    expect(html).toContain('id="side-scrim"');
  });

  it('turns the sidebar into a drawer instead of a clipped strip', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 860px) {'));
    expect(narrow).toContain('.library-shell.is-side-open > .library-side { transform: none; visibility: visible; }');
    expect(css).not.toContain('.side-scroll { max-height: 8rem; }');
    expect(css).toMatch(/^\.side-toggle \{ display: none;/m);
  });
});

describe('bookmark editor', () => {
  it('lists the save shortcut and hints it on the save button', () => {
    const html = libraryDocument([], 'en');
    expect(html).toContain(copyFor('en').shortcutSaveEdit);
    expect(html).toMatch(/type="submit" class="primary" title="[^"]*\+Enter to save"/);
  });

  it('has copy for the unsaved-changes question in both languages', () => {
    for (const language of ['en', 'zh'] as const) {
      const text = copyFor(language);
      for (const key of ['unsavedTitle', 'unsavedText', 'discardChanges', 'saveAndClose', 'editsSaved'] as const) expect(text[key]).toBeTruthy();
      expect(text.editsSaved).toContain('{v}');
    }
  });

  it('re-centres the floating bars over the list while the inspector is docked', () => {
    expect(css).toContain('.library-shell.is-editing .batch-actions, .library-shell.is-editing #library-status.toast');
  });
});

describe('settings password field', () => {
  it('can reveal the WebDAV password with a labelled toggle', () => {
    const html = settingsDocument('en');
    expect(html).toMatch(/<div class="secret-field"><input id="webdav-password"[^>]*type="password"/);
    expect(html).toMatch(/id="toggle-password"[^>]*aria-controls="webdav-password"[^>]*aria-pressed="false"[^>]*aria-label="Show password"/);
  });
});
