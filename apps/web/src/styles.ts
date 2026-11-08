/**
 * LumaMark Docker Web Design System
 * Shares semantic tokens, contrast guarantees, light/dark themes, and 6 accent palettes with the browser extension.
 */
export const WEB_STYLES = `
:root {
  color-scheme: light;
  font-family: "Inter", "SF Pro Display", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei UI", sans-serif;
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  --canvas: #f3f4f8;
  --surface: #ffffff;
  --surface-raised: #ffffff;
  --surface-sunken: #eceef3;
  --sidebar: #f3f4f8;
  --text: #15171f;
  --muted: #5a5f6e;
  --border: #e3e6ef;
  --border-strong: #ced2df;
  --on-accent: #ffffff;
  --danger: #c8233f;
  --success: #15794a;
  --warning: #9a5800;
  --star: #d99000;
  --hover: color-mix(in srgb, var(--text) 5%, transparent);
  --press: color-mix(in srgb, var(--text) 9%, transparent);
  --accent-soft: color-mix(in srgb, var(--accent) 12%, transparent);
  --accent-glow: color-mix(in srgb, var(--accent) 20%, transparent);
  --accent-line: color-mix(in srgb, var(--accent) 32%, transparent);
  --danger-soft: color-mix(in srgb, var(--danger) 11%, transparent);
  --success-soft: color-mix(in srgb, var(--success) 12%, transparent);
  --warning-soft: color-mix(in srgb, var(--warning) 12%, transparent);
  --focus-ring: color-mix(in srgb, var(--accent) 68%, transparent);
  --glass: color-mix(in srgb, var(--surface) 84%, transparent);
  --glass-strong: color-mix(in srgb, var(--surface-raised) 92%, transparent);
  --text-2xs: 0.6875rem;
  --text-xs: 0.75rem;
  --text-sm: 0.8125rem;
  --text-md: 0.875rem;
  --text-lg: 1.0625rem;
  --text-xl: 1.375rem;
  --text-2xl: 1.875rem;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --radius-sm: 0.5rem;
  --radius-md: 0.6875rem;
  --radius-lg: 0.9375rem;
  --radius-xl: 1.25rem;
  --radius-full: 999px;
  --shadow-1: 0 1px 2px rgba(18, 21, 38, 0.05), 0 2px 6px -1px rgba(18, 21, 38, 0.04);
  --shadow-2: 0 2px 4px -1px rgba(18, 21, 38, 0.05), 0 12px 28px -6px rgba(18, 21, 38, 0.12);
  --shadow-3: 0 4px 12px -2px rgba(18, 21, 38, 0.08), 0 28px 64px -12px rgba(18, 21, 38, 0.24);
  --panel-edge: 0 0 0 1px var(--border), 0 2px 8px -2px rgba(18, 21, 38, 0.05);
  --card-edge: 0 0 0 1px var(--border), 0 1px 3px rgba(18, 21, 38, 0.04);
  --scrim: rgba(15, 17, 28, 0.42);
  --tile-bg: 88% 93%;
  --tile-fg: 48% 30%;
  --band-from: 84% 88%;
  --band-to: 76% 92%;
  --motion-fast: 130ms;
  --motion-base: 210ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --side-width: 16.5rem;
  --editor-width: 24rem;
  --control: 2.1875rem;
  --panel-gap: 0.5625rem;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --canvas: #0d0e13;
    --surface: #15161d;
    --surface-raised: #1d1f28;
    --surface-sunken: #0a0a0f;
    --sidebar: #0d0e13;
    --text: #eceef4;
    --muted: #a0a5b5;
    --border: #252734;
    --border-strong: #393c4d;
    --danger: #ff8094;
    --success: #5fd79b;
    --warning: #f5bd4f;
    --star: #f5c04e;
    --hover: color-mix(in srgb, var(--text) 7%, transparent);
    --press: color-mix(in srgb, var(--text) 12%, transparent);
    --accent-soft: color-mix(in srgb, var(--accent) 16%, transparent);
    --accent-glow: color-mix(in srgb, var(--accent) 24%, transparent);
    --danger-soft: color-mix(in srgb, var(--danger) 14%, transparent);
    --success-soft: color-mix(in srgb, var(--success) 15%, transparent);
    --warning-soft: color-mix(in srgb, var(--warning) 15%, transparent);
    --glass: color-mix(in srgb, var(--surface) 82%, transparent);
    --glass-strong: color-mix(in srgb, var(--surface-raised) 90%, transparent);
    --shadow-1: 0 1px 3px rgba(0, 0, 0, 0.45);
    --shadow-2: 0 2px 6px rgba(0, 0, 0, 0.38), 0 14px 32px -6px rgba(0, 0, 0, 0.62);
    --shadow-3: 0 4px 12px rgba(0, 0, 0, 0.45), 0 30px 72px -12px rgba(0, 0, 0, 0.78);
    --panel-edge: 0 0 0 1px var(--border), inset 0 1px 0 rgba(255, 255, 255, 0.03);
    --card-edge: 0 0 0 1px var(--border), inset 0 1px 0 rgba(255, 255, 255, 0.025);
    --scrim: rgba(0, 0, 0, 0.65);
    --tile-bg: 36% 22%;
    --tile-fg: 82% 82%;
    --band-from: 44% 25%;
    --band-to: 34% 18%;
    --accent: #a99fff;
    --accent-hover: #bdb5ff;
    --accent-text: #b4abff;
    --on-accent: #17132e;
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --canvas: #0d0e13;
  --surface: #15161d;
  --surface-raised: #1d1f28;
  --surface-sunken: #0a0a0f;
  --sidebar: #0d0e13;
  --text: #eceef4;
  --muted: #a0a5b5;
  --border: #252734;
  --border-strong: #393c4d;
  --danger: #ff8094;
  --success: #5fd79b;
  --warning: #f5bd4f;
  --star: #f5c04e;
  --hover: color-mix(in srgb, var(--text) 7%, transparent);
  --press: color-mix(in srgb, var(--text) 12%, transparent);
  --accent-soft: color-mix(in srgb, var(--accent) 16%, transparent);
  --accent-glow: color-mix(in srgb, var(--accent) 24%, transparent);
  --danger-soft: color-mix(in srgb, var(--danger) 14%, transparent);
  --success-soft: color-mix(in srgb, var(--success) 15%, transparent);
  --warning-soft: color-mix(in srgb, var(--warning) 15%, transparent);
  --glass: color-mix(in srgb, var(--surface) 82%, transparent);
  --glass-strong: color-mix(in srgb, var(--surface-raised) 90%, transparent);
  --shadow-1: 0 1px 3px rgba(0, 0, 0, 0.45);
  --shadow-2: 0 2px 6px rgba(0, 0, 0, 0.38), 0 14px 32px -6px rgba(0, 0, 0, 0.62);
  --shadow-3: 0 4px 12px rgba(0, 0, 0, 0.45), 0 30px 72px -12px rgba(0, 0, 0, 0.78);
  --panel-edge: 0 0 0 1px var(--border), inset 0 1px 0 rgba(255, 255, 255, 0.03);
  --card-edge: 0 0 0 1px var(--border), inset 0 1px 0 rgba(255, 255, 255, 0.025);
  --scrim: rgba(0, 0, 0, 0.65);
  --tile-bg: 36% 22%;
  --tile-fg: 82% 82%;
  --band-from: 44% 25%;
  --band-to: 34% 18%;
}

:root, :root[data-accent="iris"] { --accent: #5a48e0; --accent-hover: #4a39c8; --accent-text: #5240d6; --accent-2: #ec5fa8; }
:root[data-accent="ember"] { --accent: #b84a0e; --accent-hover: #9c3d09; --accent-text: #a8430c; --accent-2: #f2b84e; }
:root[data-accent="rose"] { --accent: #c22a6a; --accent-hover: #a51f58; --accent-text: #b8265f; --accent-2: #ff9a62; }
:root[data-accent="ocean"] { --accent: #0b6bcb; --accent-hover: #0a5aab; --accent-text: #0a63bd; --accent-2: #38d0c0; }
:root[data-accent="jade"] { --accent: #0f7a5a; --accent-hover: #0c6549; --accent-text: #0e7354; --accent-2: #8ad14f; }
:root[data-accent="graphite"] { --accent: #262833; --accent-hover: #000000; --accent-text: #262833; --accent-2: #9499a8; }
:root[data-theme="dark"], :root[data-theme="dark"][data-accent="iris"] { --accent: #a99fff; --accent-hover: #bdb5ff; --accent-text: #b4abff; --on-accent: #17132e; }
:root[data-theme="dark"][data-accent="ember"] { --accent: #ffab70; --accent-hover: #ffbd8f; --accent-text: #ffb27d; --on-accent: #2b1405; }
:root[data-theme="dark"][data-accent="rose"] { --accent: #ff9cc4; --accent-hover: #ffb5d4; --accent-text: #ffa6ca; --on-accent: #2e0e1c; }
:root[data-theme="dark"][data-accent="ocean"] { --accent: #7cc0ff; --accent-hover: #9ccfff; --accent-text: #87c5ff; --on-accent: #06192c; }
:root[data-theme="dark"][data-accent="jade"] { --accent: #6fe0b8; --accent-hover: #8fe9c9; --accent-text: #79e3bd; --on-accent: #05211a; }
:root[data-theme="dark"][data-accent="graphite"] { --accent: #e7e9f0; --accent-hover: #ffffff; --accent-text: #e7e9f0; --on-accent: #16171d; }

*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
html { background: var(--canvas); height: 100%; }
body { margin: 0; max-width: none; padding: 0; min-height: 100%; color: var(--text); font-size: var(--text-md); background: var(--canvas); }
h1, h2, h3, h4 { line-height: 1.25; margin: 0; letter-spacing: -0.015em; }
p, ul, li { margin: 0; padding: 0; }
ul { list-style: none; }
a { color: var(--accent-text); text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 0.2em; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.ui-icon { width: 1.125em; height: 1.125em; flex: none; stroke-width: 1.85; }
.logo-mark { flex: none; display: block; filter: drop-shadow(0 2px 4px rgba(90, 72, 224, 0.22)); }
kbd { display: inline-block; padding: 0 0.42em; min-width: 1.5em; border: 1px solid var(--border-strong); border-radius: 0.35rem; background: var(--surface); color: var(--muted); box-shadow: inset 0 -1px 0 var(--border); font: 560 0.6875rem/1.55 ui-monospace, "SF Mono", Consolas, monospace; text-align: center; }

button, input, select, textarea {
  min-height: var(--control);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.35rem var(--space-3);
  font: inherit;
  font-size: var(--text-sm);
  color: inherit;
  background-color: var(--surface);
}
button { cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; font-weight: 560; white-space: nowrap; user-select: none; width: auto; }
input, select, textarea { width: 100%; min-width: 0; box-shadow: inset 0 1px 2px rgba(18, 21, 38, 0.02); }
input::placeholder, textarea::placeholder { color: var(--muted); opacity: 0.75; }
input:hover, select:not(:disabled):hover, textarea:hover { border-color: var(--border-strong); }
input:focus, select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); outline: none; }
textarea { resize: vertical; line-height: 1.5; min-height: 4.25rem; }
input[type="checkbox"] {
  appearance: none; -webkit-appearance: none;
  position: relative; flex: none; width: 1.05rem; height: 1.05rem; min-height: 0; padding: 0; margin: 0;
  border: 1.5px solid var(--border-strong); border-radius: 0.325rem; background: var(--surface); cursor: pointer;
}
input[type="checkbox"]:checked { background: var(--accent); border-color: var(--accent); }
input[type="checkbox"]:checked::after { content: ""; position: absolute; left: 0.28rem; top: 0.08rem; width: 0.3rem; height: 0.56rem; border: solid var(--on-accent); border-width: 0 1.85px 1.85px 0; transform: rotate(42deg); }

.primary {
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 92%, #ffffff) 0%, var(--accent) 100%);
  color: var(--on-accent);
  border-color: color-mix(in srgb, var(--accent) 85%, #000000);
  font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 2px 6px -1px color-mix(in srgb, var(--accent) 42%, transparent);
}
.primary:not(:disabled):hover { background: var(--accent-hover); }
.secondary { background: var(--surface); color: var(--text); border-color: var(--border-strong); box-shadow: var(--shadow-1); }
.secondary:not(:disabled):hover { background-color: var(--surface-sunken); border-color: var(--muted); }
.ghost { background: transparent; color: var(--muted); border-color: transparent; }
.ghost:not(:disabled):hover { color: var(--text); background: var(--hover); }
.danger { background: transparent; color: var(--danger); border-color: color-mix(in srgb, var(--danger) 36%, transparent); }
.danger:not(:disabled):hover { background: var(--danger-soft); border-color: var(--danger); }
.icon-btn { display: inline-grid; place-items: center; width: var(--control); height: var(--control); min-height: var(--control); padding: 0; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--muted); }
.icon-btn:hover { color: var(--text); background: var(--hover); text-decoration: none; }
.icon-btn.is-on { color: var(--star); }
.icon-btn.danger:hover { color: var(--danger); background: var(--danger-soft); }

/* ── Auth / Login / Offline Card ── */
.auth-page { position: relative; min-height: 100vh; display: grid; place-items: center; padding: var(--space-5); overflow: hidden; }
.auth-page::before {
  content: ""; position: fixed; z-index: 0; top: -12rem; left: 50%; width: 68rem; height: 38rem; transform: translateX(-50%); pointer-events: none; opacity: 0.72;
  background: radial-gradient(closest-side at 35% 50%, color-mix(in srgb, var(--accent) 22%, transparent), transparent),
              radial-gradient(closest-side at 68% 45%, color-mix(in srgb, var(--accent-2) 18%, transparent), transparent);
}
.auth-card {
  position: relative; z-index: 1; width: min(100%, 26.5rem); display: grid; gap: var(--space-4); padding: 2rem 2rem 1.75rem;
  border-radius: var(--radius-xl); background: var(--glass-strong); -webkit-backdrop-filter: saturate(180%) blur(18px); backdrop-filter: saturate(180%) blur(18px);
  box-shadow: var(--panel-edge), var(--shadow-2);
}
.auth-head { display: grid; gap: 0.5rem; text-align: center; justify-items: center; }
.auth-brand { display: inline-flex; align-items: center; gap: 0.6rem; font-size: var(--text-xl); font-weight: 760; letter-spacing: -0.025em; }
.auth-sub { color: var(--muted); font-size: var(--text-sm); line-height: 1.45; }
.auth-form { display: grid; gap: var(--space-3); }
.auth-form label { display: grid; gap: 0.35rem; font-size: var(--text-xs); font-weight: 580; color: var(--muted); }
.auth-form input { min-height: 2.5rem; font-size: var(--text-md); color: var(--text); }
.auth-form button[type="submit"] { width: 100%; min-height: 2.65rem; font-size: var(--text-md); margin-top: 0.25rem; }
.auth-foot { padding-top: var(--space-3); border-top: 1px solid var(--border); color: var(--muted); font-size: var(--text-xs); text-align: center; line-height: 1.5; }

/* ── Notice Banner ── */
#notice {
  display: flex; align-items: center; gap: 0.5rem; min-height: 0; padding: 0.55rem 0.875rem;
  border-radius: var(--radius-md); background: var(--surface-sunken); border: 1px solid var(--border);
  color: var(--text); font-size: var(--text-sm); font-weight: 520;
}
#notice:empty { display: none; }
#notice[data-tone="danger"] { background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 32%, transparent); color: var(--danger); }
#notice[data-tone="warning"] { background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 32%, transparent); color: var(--warning); }

/* ── Workspace Shell ── */
.web-shell { display: grid; grid-template-columns: var(--side-width) minmax(0, 1fr) auto; min-height: 100vh; height: 100vh; overflow: hidden; background: var(--canvas); }
.web-side { display: flex; flex-direction: column; min-height: 0; background: var(--sidebar); padding-bottom: var(--space-2); }
.side-brand-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: 0.95rem var(--space-3) 0.65rem; }
.side-brand { display: inline-flex; align-items: center; gap: 0.55rem; font-weight: 740; font-size: 0.975rem; letter-spacing: -0.02em; color: var(--text); }
.side-badge { padding: 0.1rem 0.45rem; border-radius: var(--radius-full); background: var(--accent-soft); color: var(--accent-text); font-size: var(--text-2xs); font-weight: 640; }
.side-cta { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.4rem; padding: 0 var(--space-3) var(--space-2); }
.side-cta .primary { width: 100%; min-height: 2.35rem; }
.side-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: var(--space-1) var(--space-2) var(--space-3); display: grid; gap: var(--space-3); align-content: start; }
.side-group { display: grid; gap: 2px; align-content: start; }
.side-section-head { display: flex; align-items: center; justify-content: space-between; min-height: 1.65rem; padding: 0 0.5rem; color: var(--muted); font-size: var(--text-2xs); font-weight: 660; text-transform: uppercase; letter-spacing: 0.04em; }
.side-section-head .icon-btn { width: 1.5rem; height: 1.5rem; min-height: 0; }
.nav-btn {
  display: flex; align-items: center; justify-content: flex-start; gap: 0.5rem; width: 100%; min-width: 0; min-height: 2.0625rem;
  padding: 0.2rem 0.5rem 0.2rem 0.625rem; border: 1px solid transparent; border-radius: var(--radius-sm);
  background: transparent; color: var(--text); text-align: left; font-size: var(--text-sm); font-weight: 500;
}
.nav-btn:hover { background: var(--hover); }
.nav-btn[aria-pressed="true"] { background: var(--surface); color: var(--text); font-weight: 620; box-shadow: var(--panel-edge); }
.nav-btn[aria-pressed="true"] .nav-icon { color: var(--accent-text); }
.nav-btn[aria-pressed="true"] .nav-count { background: var(--accent-soft); color: var(--accent-text); }
.nav-icon { display: inline-grid; place-items: center; color: var(--muted); flex: none; }
.nav-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-count { flex: none; padding: 0.05rem 0.42rem; border-radius: var(--radius-full); background: color-mix(in srgb, var(--text) 6%, transparent); color: var(--muted); font-size: var(--text-2xs); font-weight: 580; font-variant-numeric: tabular-nums; }

.folder-node { display: grid; gap: 1px; }
.folder-children { margin-left: 0.75rem; padding-left: 0.35rem; border-left: 1px solid var(--border-strong); display: grid; gap: 1px; }
.folder-row { position: relative; display: flex; align-items: center; min-width: 0; }
.folder-tools { position: absolute; right: 0.25rem; display: flex; gap: 1px; opacity: 0; pointer-events: none; background: var(--surface); border-radius: 0.35rem; box-shadow: var(--shadow-1); }
.folder-row:hover .folder-tools, .folder-row:focus-within .folder-tools { opacity: 1; pointer-events: auto; }
.folder-row:hover .nav-count { opacity: 0; }
.folder-tool { width: 1.4rem; height: 1.4rem; min-height: 0; padding: 0; border: 0; border-radius: 0.3rem; background: transparent; color: var(--muted); }
.folder-tool:hover { background: var(--hover); color: var(--text); }
.folder-tool.danger:hover { background: var(--danger-soft); color: var(--danger); }
.folder-inline-form { display: flex; gap: 0.25rem; padding: 0.2rem 0.35rem; align-items: center; }
.folder-inline-form input { min-height: 1.75rem; padding: 0.15rem 0.45rem; font-size: var(--text-xs); }
.folder-inline-form button { min-height: 1.75rem; padding: 0 0.5rem; font-size: var(--text-xs); }

.tag-cloud { display: flex; flex-wrap: wrap; gap: 0.3rem; padding: 0.15rem 0.4rem; }
.tag-pill {
  display: inline-flex; align-items: center; gap: 0.3rem; min-height: 1.5625rem; padding: 0 0.55rem;
  border: 1px solid var(--border); border-radius: var(--radius-full); background: color-mix(in srgb, var(--surface) 65%, transparent);
  color: var(--text); font-size: var(--text-xs); font-weight: 520; max-width: 100%;
}
.tag-pill:hover { background: var(--surface); border-color: var(--border-strong); }
.tag-pill[aria-pressed="true"] { background: var(--accent); border-color: transparent; color: var(--on-accent); }
.tag-pill-count { font-size: var(--text-2xs); opacity: 0.75; font-variant-numeric: tabular-nums; }

.side-foot {
  display: grid; gap: 0.45rem; padding: var(--space-2) var(--space-3) var(--space-1);
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}
.account-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 0; }
.account-pill { display: inline-flex; align-items: center; gap: 0.45rem; min-width: 0; font-size: var(--text-xs); font-weight: 600; color: var(--text); }
.account-avatar { display: inline-grid; place-items: center; width: 1.55rem; height: 1.55rem; border-radius: var(--radius-full); background: var(--accent-soft); color: var(--accent-text); font-size: var(--text-xs); font-weight: 700; flex: none; }
.account-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.side-foot-actions { display: flex; align-items: center; gap: 2px; }
.side-foot-actions .icon-btn { width: 1.8rem; height: 1.8rem; min-height: 0; }
.theme-popover { display: flex; align-items: center; justify-content: space-between; gap: 0.35rem; padding: 0.35rem 0.5rem; border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--card-edge); }
.swatch-row { display: flex; gap: 0.35rem; align-items: center; }
.swatch-btn { width: 1.15rem; height: 1.15rem; min-height: 0; padding: 0; border-radius: var(--radius-full); border: 2px solid transparent; }
.swatch-btn[aria-pressed="true"] { box-shadow: 0 0 0 1.5px var(--surface), 0 0 0 3px var(--accent); }
.swatch-btn[data-accent-choice="iris"] { background: #5a48e0; }
.swatch-btn[data-accent-choice="ember"] { background: #b84a0e; }
.swatch-btn[data-accent-choice="rose"] { background: #c22a6a; }
.swatch-btn[data-accent-choice="ocean"] { background: #0b6bcb; }
.swatch-btn[data-accent-choice="jade"] { background: #0f7a5a; }
.swatch-btn[data-accent-choice="graphite"] { background: #262833; }

/* ── Main Content Surface ── */
.web-main {
  position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0;
  margin: var(--panel-gap) var(--panel-gap) var(--panel-gap) 0; overflow-y: auto;
  border-radius: var(--radius-xl); background: var(--surface); box-shadow: var(--panel-edge);
}
.web-top {
  position: sticky; top: 0; z-index: 10; display: grid; gap: var(--space-3);
  padding: 1.125rem var(--space-5) var(--space-3);
  background: var(--glass); -webkit-backdrop-filter: saturate(180%) blur(16px); backdrop-filter: saturate(180%) blur(16px);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}
.top-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.title-group { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
.title-group h1 { font-size: var(--text-xl); font-weight: 720; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.count-pill { padding: 0.125rem 0.55rem; border-radius: var(--radius-full); background: var(--surface-sunken); color: var(--muted); font-size: var(--text-xs); font-weight: 580; font-variant-numeric: tabular-nums; }
.top-tools { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.view-switcher { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--border); background: var(--surface-sunken); border-radius: var(--radius-md); }
.view-switcher button { width: 1.85rem; min-height: 1.65rem; padding: 0; border: 0; border-radius: 0.375rem; background: transparent; color: var(--muted); }
.view-switcher button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: var(--shadow-1); }

.search-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2); align-items: center; }
#search { display: flex; align-items: center; gap: var(--space-2); position: relative; }
.search-box { position: relative; flex: 1; display: flex; align-items: center; min-width: 0; }
.search-box .search-glyph { position: absolute; left: 0.8rem; color: var(--muted); pointer-events: none; display: inline-grid; }
.search-box input[name="query"] {
  min-height: 2.5rem; padding-left: 2.3rem; padding-right: 4.5rem;
  border-color: var(--border); border-radius: var(--radius-md); background: var(--surface-sunken); font-size: var(--text-md);
}
.search-box input[name="query"]:focus { background: var(--surface); border-color: var(--accent); }
.search-submit { position: absolute; right: 0.3rem; min-height: 1.9rem; padding: 0 0.65rem; border-radius: var(--radius-sm); font-size: var(--text-xs); }
.filter-controls { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.check-chip {
  display: inline-flex; align-items: center; gap: 0.4rem; min-height: 2.5rem; padding: 0 0.75rem;
  border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-sunken);
  font-size: var(--text-xs); font-weight: 560; cursor: pointer; user-select: none; color: var(--muted);
}
.check-chip:hover { color: var(--text); border-color: var(--border-strong); }
.sort-select { width: auto; min-height: 2.5rem; background: var(--surface-sunken); color: var(--muted); font-size: var(--text-xs); font-weight: 560; }

/* ── Tool Drawers (Add / Import / Export) ── */
.drawer-panel {
  padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--surface-sunken) 45%, var(--surface)); box-shadow: var(--shadow-1);
  display: grid; gap: var(--space-3);
}
.drawer-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.drawer-head h2 { font-size: var(--text-md); font-weight: 680; display: inline-flex; align-items: center; gap: 0.45rem; }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.field-grid label, .drawer-panel label { display: grid; gap: 0.3rem; font-size: var(--text-xs); font-weight: 580; color: var(--muted); }
.field-grid label.span-2 { grid-column: 1 / -1; }
.field-grid label.check-inline, .drawer-panel label.check-inline { display: inline-flex; flex-direction: row; align-items: center; gap: 0.45rem; color: var(--text); font-size: var(--text-sm); cursor: pointer; }
.drawer-foot { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); flex-wrap: wrap; }
#export-output { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: var(--text-xs); min-height: 7.5rem; background: var(--surface); }

/* ── Scope Banner & List Header ── */
.web-body { flex: 1; padding: var(--space-3) var(--space-4) 5.5rem; display: grid; gap: var(--space-3); align-content: start; }
.scope-banner {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap;
  padding: 0.85rem var(--space-4); border: 1px solid var(--accent-line); border-radius: var(--radius-lg);
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, var(--surface)), color-mix(in srgb, var(--accent-2) 5%, var(--surface)));
}
.scope-banner-text { display: grid; gap: 2px; }
.scope-banner-text strong { font-size: var(--text-sm); font-weight: 650; }
.scope-banner-text p { font-size: var(--text-xs); color: var(--muted); }
.list-subbar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: 0 0.5rem; color: var(--muted); font-size: var(--text-xs); }
.check-line { display: inline-flex; align-items: center; gap: 0.45rem; cursor: pointer; user-select: none; }

/* ── Bookmarks List / Compact / Grid ── */
#bookmarks { display: grid; gap: 0.35rem; }
#bookmarks[data-view="grid"] { grid-template-columns: repeat(auto-fill, minmax(16.5rem, 1fr)); gap: 0.875rem; }
.bm-item {
  position: relative; display: grid; gap: 0.5rem; padding: 0.65rem 0.85rem;
  border: 1px solid transparent; border-radius: var(--radius-lg); background: var(--surface);
  transition: background-color var(--motion-fast), border-color var(--motion-fast), box-shadow var(--motion-fast);
}
.bm-item:hover { background: var(--hover); border-color: color-mix(in srgb, var(--border) 85%, transparent); }
.bm-item.is-selected { background: var(--accent-soft); border-color: var(--accent-line); }
.bm-item.is-editing { background: var(--surface-sunken); border-color: var(--accent); box-shadow: var(--shadow-1); }

.bm-row { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto auto; gap: 0.75rem; align-items: center; min-width: 0; }
.bm-check { display: inline-flex; align-items: center; opacity: 0.35; }
.bm-item:hover .bm-check, .bm-item.is-selected .bm-check { opacity: 1; }
.bm-tile {
  display: inline-grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: 0.625rem;
  background: hsl(var(--tile-hue, 220) var(--tile-bg)); color: hsl(var(--tile-hue, 220) var(--tile-fg));
  font-weight: 700; font-size: var(--text-md); flex: none; box-shadow: var(--card-edge);
}
.bm-main { display: grid; gap: 2px; min-width: 0; }
.bm-title-line { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
.bm-title-line h3 { font-size: var(--text-md); font-weight: 580; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bm-title-link { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 580; font-size: var(--text-md); }
.bm-title-link:hover { color: var(--accent-text); text-decoration: none; }
.bm-star-badge { color: var(--star); font-size: 0.85rem; flex: none; }
.bm-meta { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; color: var(--muted); font-size: var(--text-xs); min-width: 0; }
.bm-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 26rem; color: var(--muted); }
.bm-folder-pill { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.05rem 0.45rem; border-radius: var(--radius-sm); background: var(--surface-sunken); color: var(--accent-text); font-weight: 550; }
.bm-notes { color: var(--muted); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.9; }
.bm-tags { display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; }
.bm-tag { padding: 0.05rem 0.5rem; border: 1px solid color-mix(in srgb, var(--border) 80%, transparent); border-radius: var(--radius-full); background: var(--surface-sunken); color: var(--muted); font-size: var(--text-2xs); font-weight: 540; cursor: pointer; }
.bm-tag:hover { border-color: var(--accent-line); color: var(--accent-text); }
.bm-actions { display: flex; align-items: center; gap: 2px; }
.bm-actions .icon-btn { width: 1.75rem; height: 1.75rem; min-height: 0; }

#bookmarks[data-view="compact"] .bm-item { padding: 0.3rem 0.65rem; border-radius: var(--radius-sm); }
#bookmarks[data-view="compact"] .bm-tile { width: 1.4rem; height: 1.4rem; font-size: var(--text-2xs); border-radius: 0.35rem; }
#bookmarks[data-view="compact"] .bm-notes { display: none; }

#bookmarks[data-view="grid"] .bm-item {
  display: flex; flex-direction: column; justify-content: space-between; padding: var(--space-3);
  border: 1px solid var(--border); box-shadow: var(--shadow-1); min-height: 9.5rem;
}
#bookmarks[data-view="grid"] .bm-row { display: flex; flex-direction: column; align-items: stretch; gap: 0.5rem; }

.bm-edit-drawer {
  margin-top: 0.35rem; padding-top: var(--space-3); border-top: 1px solid var(--border);
  display: grid; gap: var(--space-3);
}

/* ── Conflict & Import Decision Cards ── */
#conflicts, #import-choice {
  display: grid; gap: var(--space-3); padding: var(--space-4);
  border: 1px solid color-mix(in srgb, var(--warning) 40%, var(--border)); border-radius: var(--radius-xl);
  background: color-mix(in srgb, var(--warning) 6%, var(--surface)); box-shadow: var(--shadow-1);
}
.conflict-card {
  display: grid; gap: var(--space-3); padding: var(--space-4);
  border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
}
.conflict-compare { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.conflict-box {
  display: grid; gap: 0.35rem; padding: var(--space-3); border: 1px solid var(--border);
  border-radius: var(--radius-md); background: var(--surface-sunken); font-size: var(--text-xs);
}
.conflict-box-head { font-weight: 660; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }

/* ── Batch Floating Dock ── */
.batch-dock {
  position: fixed; z-index: 30; left: calc(50% + var(--side-width) / 2); bottom: 1.25rem; transform: translateX(-50%);
  display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap;
  padding: 0.45rem 0.75rem; border-radius: var(--radius-full);
  background: var(--glass-strong); -webkit-backdrop-filter: saturate(180%) blur(18px); backdrop-filter: saturate(180%) blur(18px);
  box-shadow: 0 0 0 1px var(--border-strong), var(--shadow-3);
}

/* ── Empty State ── */
.empty-box {
  display: grid; justify-items: center; gap: 0.5rem; padding: 3.5rem var(--space-4);
  text-align: center; color: var(--muted);
}
.empty-badge {
  display: inline-grid; place-items: center; width: 3rem; height: 3rem; border-radius: 0.9rem;
  background: var(--accent-soft); color: var(--accent-text); margin-bottom: 0.25rem;
}
.empty-box h2 { font-size: var(--text-lg); color: var(--text); }
.empty-box p { font-size: var(--text-sm); max-width: 24rem; }
.side-empty { padding: 0.25rem 0.6rem; font-size: var(--text-xs); color: var(--muted); }

/* ── Panels: hints, file picker, export & import choices ── */
.form-alert {
  display: flex; align-items: flex-start; gap: 0.45rem; padding: 0.55rem 0.75rem; border-radius: var(--radius-md);
  font-size: var(--text-sm); background: var(--danger-soft); color: var(--danger);
}
.form-alert[data-tone="warning"] { background: var(--warning-soft); color: var(--warning); }
.form-alert svg { width: 1rem; height: 1rem; flex: none; margin-top: 0.1rem; }
.form-hint { font-size: var(--text-xs); color: var(--muted); margin-right: auto; }
.file-drop {
  display: grid; place-items: center; min-height: 4.5rem; padding: var(--space-3); cursor: pointer;
  border: 1.5px dashed var(--border-strong); border-radius: var(--radius-lg); background: var(--surface-sunken);
  color: var(--muted); font-size: var(--text-sm); transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.file-drop:hover, .file-drop:focus-within { border-color: var(--accent); color: var(--accent-text); background: var(--accent-soft); }
.file-drop > span { display: inline-flex; align-items: center; gap: 0.4rem; }
.file-drop svg { width: 1rem; height: 1rem; }
.file-drop input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.inline-select { display: inline-flex !important; align-items: center; gap: 0.5rem; margin-right: auto; font-size: var(--text-xs); color: var(--muted); }
.inline-select select { width: auto; }
.export-grid, .choice-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: var(--space-3); }
.export-card, .choice-card {
  display: grid !important; justify-items: start; align-content: start; gap: 0.3rem; height: auto !important;
  padding: var(--space-3) var(--space-4) !important; text-align: left; white-space: normal; border-radius: var(--radius-lg) !important;
}
.export-card svg { width: 1.1rem; height: 1.1rem; color: var(--accent-text); }
.export-card strong, .choice-card strong { font-size: var(--text-md); color: var(--text); }
.export-card small, .choice-card small { font-size: var(--text-xs); font-weight: 400; color: var(--muted); line-height: 1.45; }

/* ── Conflict details ── */
.conflict-field { display: grid; gap: 0.1rem; }
.conflict-field-name { font-size: var(--text-2xs); color: var(--muted); }
.conflict-field p { font-size: var(--text-sm); color: var(--text); overflow-wrap: anywhere; white-space: pre-wrap; }
.conflict-box button { margin-top: 0.35rem; justify-self: start; }
.conflict-box.is-chosen { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
.conflict-merge summary { cursor: pointer; font-size: var(--text-sm); color: var(--muted); }
.conflict-merge summary:hover { color: var(--text); }
.conflict-merge[open] summary { margin-bottom: var(--space-3); }
.conflict-merge form { display: grid; gap: var(--space-3); }

/* ── Confirm-armed destructive buttons ── */
.is-armed { background: var(--danger) !important; color: var(--surface) !important; border-color: transparent !important; }

/* ── Show more, batch forms ── */
.show-more { justify-self: center; margin: var(--space-4) auto; display: flex; }
.batch-count { font-size: var(--text-sm); font-weight: 650; padding-left: 0.35rem; }
.batch-form { display: inline-flex; align-items: center; gap: 0.3rem; }
.batch-form input { width: 9rem; height: 2rem; padding: 0 0.6rem; }

/* ── Toast ── */
.toast {
  position: fixed; z-index: 40; right: 1.25rem; bottom: 1.25rem; max-width: min(26rem, calc(100vw - 2.5rem));
  display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.6rem 0.6rem 0.85rem;
  border-radius: var(--radius-lg); background: var(--text); color: var(--canvas);
  box-shadow: var(--shadow-3); font-size: var(--text-sm); animation: lm-rise 0.18s ease-out;
}
.toast > svg { width: 1rem; height: 1rem; flex: none; color: color-mix(in srgb, var(--success) 60%, var(--canvas)); }
.toast > span { flex: 1; }
.toast button {
  border: 0; background: transparent; color: inherit; font: inherit; font-weight: 650; cursor: pointer;
  padding: 0.25rem 0.5rem; border-radius: var(--radius-sm);
}
.toast button:hover { background: color-mix(in srgb, var(--canvas) 16%, transparent); }
.toast [data-action="undo"] { color: color-mix(in srgb, var(--accent) 55%, var(--canvas)); }
.toast-close { display: inline-grid; place-items: center; opacity: 0.7; }
.toast-close svg { width: 0.9rem; height: 0.9rem; }
.batch-dock ~ .toast { bottom: 5rem; }
.web-shell:has(.batch-dock) .web-body { padding-bottom: 7rem; }
@keyframes lm-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* ── Modal dialog ── */
.modal-backdrop {
  position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 1.5rem;
  background: color-mix(in srgb, #0b0c14 46%, transparent);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); animation: lm-fade 0.14s ease-out;
}
.modal {
  position: relative; width: min(34rem, 100%); max-height: calc(100vh - 3rem); display: flex; flex-direction: column;
  border-radius: var(--radius-xl); background: var(--surface-raised); color: var(--text);
  box-shadow: 0 0 0 1px var(--border), var(--shadow-3); animation: lm-pop 0.16s cubic-bezier(0.2, 0.9, 0.3, 1.1);
}
.modal-wide { width: min(42rem, 100%); }
.modal-head { display: flex; align-items: flex-start; gap: 0.75rem; padding: 1.15rem 1.25rem 0.85rem; }
.modal-head .bm-tile { flex: none; }
.modal-icon {
  flex: none; display: inline-grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: 0.7rem;
  background: var(--accent-soft); color: var(--accent-text);
}
.modal-icon svg { width: 1.1rem; height: 1.1rem; }
.modal-title-group { flex: 1; min-width: 0; display: grid; gap: 0.15rem; }
.modal-title-group h2 { font-size: var(--text-lg); font-weight: 680; letter-spacing: -0.01em; }
.modal-sub { font-size: var(--text-xs); color: var(--muted); overflow-wrap: anywhere; }
.modal-close { flex: none; margin: -0.25rem -0.35rem 0 0; }
.modal-body { display: grid; gap: var(--space-3); padding: 0.25rem 1.25rem 1rem; overflow-y: auto; min-height: 0; }
.modal-foot {
  display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem; padding: 0.85rem 1.25rem;
  border-top: 1px solid var(--border); background: color-mix(in srgb, var(--surface-sunken) 45%, transparent);
  border-radius: 0 0 var(--radius-xl) var(--radius-xl);
}
.modal-foot .form-hint { margin-right: auto; }
.modal-foot .modal-delete { margin-right: auto; border-color: transparent; }
.modal-foot .modal-delete svg { width: 0.95rem; height: 0.95rem; }
.web-shell:has(.modal-backdrop) .web-main { overflow: hidden; }
.empty-add { max-width: 40rem; margin: 0 auto var(--space-5); width: 100%; }
@keyframes lm-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes lm-pop { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }

/* ── Account management ── */
.account-create {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 0.6rem;
  padding: 0.85rem; border-radius: var(--radius-lg); background: var(--surface-sunken);
}
.account-create-fields { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 0.6rem; }
.account-create label, .account-reset label { display: grid; gap: 0.3rem; font-size: var(--text-xs); color: var(--muted); font-weight: 600; }
.password-field { display: flex; gap: 0.35rem; align-items: center; }
.password-field input { flex: 1; min-width: 0; font-family: ui-monospace, "SF Mono", Consolas, monospace; }
.password-field .ghost { flex: none; }
.account-list-head { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.35rem; font-size: var(--text-xs); font-weight: 660; color: var(--muted); }
.account-list { list-style: none; margin: 0; padding: 0; display: grid; border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.account-row + .account-row { border-top: 1px solid var(--border); }
.account-row-main { display: flex; align-items: center; gap: 0.7rem; padding: 0.65rem 0.8rem; }
.account-row-text { flex: 1; min-width: 0; display: grid; gap: 0.1rem; }
.account-row-name { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; font-size: var(--text-md); font-weight: 620; overflow-wrap: anywhere; }
.account-row-meta { font-size: var(--text-xs); color: var(--muted); }
.account-row-actions { display: flex; gap: 0.25rem; flex: none; }
.account-row-actions button { min-height: 2rem; padding: 0 0.65rem; font-size: var(--text-sm); }
.account-row-actions .ghost.danger { border-color: transparent; }
.account-reset { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; padding: 0 0.8rem 0.75rem 3.55rem; }
.account-reset .password-field { flex: 1 1 14rem; }
.account-empty { padding: 1.25rem; text-align: center; font-size: var(--text-sm); color: var(--muted); }
.account-notice {
  display: flex; align-items: flex-start; gap: 0.6rem; padding: 0.75rem 0.85rem; border-radius: var(--radius-lg);
  background: var(--success-soft); color: var(--text); font-size: var(--text-sm);
}
.account-notice > svg { flex: none; width: 1.05rem; height: 1.05rem; margin-top: 0.15rem; color: var(--success); }
.account-notice > p { flex: 1; min-width: 0; }
.account-notice-body { flex: 1; min-width: 0; display: grid; gap: 0.5rem; }
.account-notice-body > button { justify-self: start; min-height: 1.9rem; }
.account-notice .icon-btn { flex: none; width: 1.75rem; height: 1.75rem; min-height: 0; }
.credential-list { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.25rem 0.75rem; margin: 0; }
.credential-list dt { color: var(--muted); font-size: var(--text-xs); align-self: center; }
.credential-list dd { margin: 0; }
.credential-list code {
  font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: var(--text-sm); padding: 0.1rem 0.4rem;
  border-radius: 0.35rem; background: var(--surface); user-select: all; overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .modal-backdrop { place-items: end center; padding: 0; }
  .modal, .modal-wide { width: 100%; max-height: calc(100vh - 2.5rem); border-radius: var(--radius-xl) var(--radius-xl) 0 0; }
  .modal-foot { border-radius: 0; padding-bottom: max(0.85rem, env(safe-area-inset-bottom)); }
  .modal-foot .form-hint { display: none; }
  .account-create, .account-create-fields { grid-template-columns: minmax(0, 1fr); }
  .account-row-main { flex-wrap: wrap; }
  .account-reset { padding-left: 0.8rem; }
}

/* ── Busy indicator while writing to the server ── */
.web-shell[aria-busy="true"] .web-main::before {
  content: ""; position: absolute; z-index: 5; inset: 0 0 auto; height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent); background-size: 40% 100%;
  background-repeat: no-repeat; animation: lm-busy 1s linear infinite;
}
@keyframes lm-busy { from { background-position: -40% 0; } to { background-position: 140% 0; } }
@media (prefers-reduced-motion: reduce) {
  .toast, .web-shell[aria-busy="true"] .web-main::before, .modal, .modal-backdrop { animation: none; }
}

@media (max-width: 900px) {
  .web-shell { grid-template-columns: minmax(0, 1fr); height: auto; min-height: 100vh; overflow: visible; }
  .web-side {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "brand foot" "scroll scroll";
    align-items: center; padding-bottom: 0;
  }
  .side-brand-row { grid-area: brand; padding: 0.7rem var(--space-3) 0.5rem; justify-content: flex-start; }
  .side-foot { grid-area: foot; display: flex; align-items: center; gap: 0.35rem; padding: 0.5rem var(--space-3) 0.5rem 0; border: 0; margin: 0; }
  .theme-popover { padding: 0.2rem; background: transparent; box-shadow: none; }
  .swatch-row, .account-name { display: none; }
  .side-scroll {
    grid-area: scroll; display: flex; gap: 0.35rem; overflow-x: auto; overflow-y: hidden; padding: 0 var(--space-3) 0.6rem;
    scrollbar-width: none; -webkit-mask-image: linear-gradient(90deg, #000 92%, transparent);
  }
  .side-scroll::-webkit-scrollbar { display: none; }
  .side-group, .folder-node, .folder-children, .folder-row, .tag-cloud { display: contents; }
  .side-section-head, .side-empty, .folder-tools, .tag-pill-count { display: none; }
  .side-scroll .nav-btn, .side-scroll .tag-pill {
    flex: none; width: auto; min-height: 2rem; padding: 0.25rem 0.7rem; border-radius: var(--radius-full);
    border: 1px solid var(--border); background: var(--surface);
  }
  .side-scroll .nav-btn[aria-pressed="true"] { border-color: var(--accent-line); }
  .side-scroll .nav-label { overflow: visible; }
  .folder-inline-form { flex: none; }
  .web-main { margin: 0 var(--panel-gap) var(--panel-gap); }
  .field-grid, .conflict-compare { grid-template-columns: minmax(0, 1fr); }
  .batch-dock {
    left: 0.75rem; right: 0.75rem; bottom: 0.75rem; transform: none; justify-content: center;
    border-radius: var(--radius-xl); padding: 0.55rem;
  }
  .batch-form input { width: 7.5rem; }
  .batch-dock ~ .toast { bottom: 9rem; }
}
`;
