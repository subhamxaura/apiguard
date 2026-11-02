/**
 * HTML reporter for API Guard.
 * Generates an interactive, zero-dependency, single-file HTML report.
 * Conforms strictly to the Hallmark Anti-AI-Slop design floor.
 */
import type { DiffReport } from '../core/models/report.js';
import type { ApiChange } from '../core/models/change.js';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function endpointOf(change: ApiChange): string {
  const loc = change.location;
  if (loc.method && loc.path) return `${loc.method} ${loc.path}`;
  if (loc.path && loc.path !== '/') return loc.path;
  if (loc.context === 'webhook') return `webhook ${loc.componentName ?? ''}`.trim();
  if (loc.componentName) return `component ${loc.componentName}`;
  return 'API Root';
}

function valueRepr(v: unknown): string {
  if (v === undefined) return 'absent';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** Render a standalone, interactive HTML dashboard. */
export function renderHtml(report: DiffReport): string {
  const breaking = report.summary.bySeverity.error;
  const warnings = report.summary.bySeverity.warning;
  const infos = report.summary.bySeverity.info;
  const total = report.summary.total;
  const isPass = breaking === 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>API Guard Report - ${isPass ? 'Passed' : 'Breaking Changes Found'}</title>
  <style>
    /* Hallmark stamp: modern-minimal developer tool contract dashboard */
    :root {
      --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      --bg-page: #f8fafc;
      --bg-card: #ffffff;
      --bg-input: #ffffff;
      --border-subtle: #e2e8f0;
      --border-strong: #cbd5e1;
      --text-main: #0f172a;
      --text-muted: #64748b;
      --color-pass: #059669;
      --color-pass-bg: #ecfdf5;
      --color-pass-border: #a7f3d0;
      --color-fail: #dc2626;
      --color-fail-bg: #fef2f2;
      --color-fail-border: #fecaca;
      --color-warn: #d97706;
      --color-warn-bg: #fffbeb;
      --color-warn-border: #fde68a;
      --color-info: #0284c7;
      --color-info-bg: #f0f9ff;
      --color-info-border: #bae6fd;
      --color-accent: #2563eb;
      --color-accent-bg: #eff6ff;
      --focus-ring: #3b82f6;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg-page: #090d16;
        --bg-card: #131b2e;
        --bg-input: #1a243b;
        --border-subtle: #1e293b;
        --border-strong: #334155;
        --text-main: #f1f5f9;
        --text-muted: #94a3b8;
        --color-pass: #10b981;
        --color-pass-bg: #064e3b33;
        --color-pass-border: #065f46;
        --color-fail: #f87171;
        --color-fail-bg: #7f1d1d33;
        --color-fail-border: #991b1b;
        --color-warn: #fbbf24;
        --color-warn-bg: #78350f33;
        --color-warn-border: #92400e;
        --color-info: #38bdf8;
        --color-info-bg: #0c4a6e33;
        --color-info-border: #075985;
        --color-accent: #60a5fa;
        --color-accent-bg: #1e3a8a33;
        --focus-ring: #60a5fa;
      }
    }

    html, body {
      margin: 0;
      padding: 0;
      overflow-x: clip;
      background: var(--bg-page);
      color: var(--text-main);
      font-family: var(--font-body);
      line-height: 1.5;
      font-size: 15px;
    }

    * {
      box-sizing: border-box;
    }

    *:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2.5rem 1.5rem 5rem 1.5rem;
    }

    .header {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 1.75rem 2rem;
      margin-bottom: 2rem;
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 1.25rem;
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .brand-title {
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      font-size: 0.825rem;
      font-weight: 600;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      border: 1px solid;
    }

    .status-badge.pass {
      background: var(--color-pass-bg);
      color: var(--color-pass);
      border-color: var(--color-pass-border);
    }

    .status-badge.fail {
      background: var(--color-fail-bg);
      color: var(--color-fail);
      border-color: var(--color-fail-border);
    }

    .spec-metadata {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.25rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--border-subtle);
      font-size: 0.875rem;
      color: var(--text-muted);
    }

    .meta-box strong {
      color: var(--text-main);
      display: block;
      margin-bottom: 0.2rem;
    }

    .meta-code {
      font-family: var(--font-mono);
      font-size: 0.8rem;
    }

    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 1.25rem 1.5rem;
    }

    .stat-label {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 0.35rem;
    }

    .stat-value {
      font-size: 1.75rem;
      font-weight: 700;
      line-height: 1;
    }

    .stat-card.error .stat-value { color: var(--color-fail); }
    .stat-card.warning .stat-value { color: var(--color-warn); }
    .stat-card.info .stat-value { color: var(--color-info); }
    .stat-card.total .stat-value { color: var(--text-main); }

    .semver-banner {
      background: var(--color-accent-bg);
      border: 1px solid var(--border-subtle);
      border-left: 4px solid var(--color-accent);
      border-radius: 6px;
      padding: 1rem 1.25rem;
      margin-bottom: 2rem;
      font-size: 0.9rem;
    }

    .semver-banner strong {
      color: var(--text-main);
    }

    .controls-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
    }

    .search-input {
      flex: 1 1 260px;
      padding: 0.6rem 0.9rem;
      font-size: 0.9rem;
      border: 1px solid var(--border-strong);
      border-radius: 6px;
      background: var(--bg-input);
      color: var(--text-main);
    }

    .filter-group {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .filter-btn {
      padding: 0.45rem 0.85rem;
      font-size: 0.825rem;
      font-weight: 500;
      border: 1px solid var(--border-strong);
      border-radius: 6px;
      background: var(--bg-card);
      color: var(--text-muted);
      cursor: pointer;
    }

    .filter-btn.active {
      background: var(--color-accent);
      color: #ffffff;
      border-color: var(--color-accent);
    }

    .changes-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .change-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 1.25rem 1.5rem;
    }

    .change-card.error { border-left: 4px solid var(--color-fail); }
    .change-card.warning { border-left: 4px solid var(--color-warn); }
    .change-card.info { border-left: 4px solid var(--color-info); }

    .change-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }

    .change-title-group {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.6rem;
    }

    .severity-tag {
      font-size: 0.725rem;
      font-weight: 700;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .severity-tag.error { background: var(--color-fail-bg); color: var(--color-fail); border: 1px solid var(--color-fail-border); }
    .severity-tag.warning { background: var(--color-warn-bg); color: var(--color-warn); border: 1px solid var(--color-warn-border); }
    .severity-tag.info { background: var(--color-info-bg); color: var(--color-info); border: 1px solid var(--color-info-border); }

    .rule-name {
      font-family: var(--font-mono);
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-main);
    }

    .endpoint-pill {
      font-family: var(--font-mono);
      font-size: 0.825rem;
      color: var(--text-muted);
      background: var(--bg-page);
      border: 1px solid var(--border-subtle);
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
    }

    .location-info {
      font-family: var(--font-mono);
      font-size: 0.775rem;
      color: var(--text-muted);
    }

    .change-message {
      font-size: 0.95rem;
      margin: 0 0 0.75rem 0;
      color: var(--text-main);
      word-break: break-word;
    }

    .suggestion-box {
      font-size: 0.85rem;
      color: var(--text-muted);
      background: var(--bg-page);
      border-radius: 6px;
      padding: 0.6rem 0.9rem;
      border: 1px solid var(--border-subtle);
    }

    .suggestion-box strong {
      color: var(--text-main);
    }

    .diff-values {
      margin-top: 0.75rem;
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      font-family: var(--font-mono);
      font-size: 0.8rem;
    }

    .val-block {
      padding: 0.35rem 0.65rem;
      border-radius: 4px;
      background: var(--bg-page);
      border: 1px solid var(--border-subtle);
    }

    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      color: var(--text-muted);
    }

    @media (prefers-reduced-motion: reduce) {
      * {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <div class="header-top">
        <div class="title-row">
          <h1 class="brand-title">API Guard Diff Report</h1>
          <span class="status-badge ${isPass ? 'pass' : 'fail'}">
            ${isPass ? 'PASS: No Breaking Changes' : 'FAIL: Breaking Changes Detected'}
          </span>
        </div>
        <div style="font-size: 0.85rem; color: var(--text-muted);">
          Generated by apiguard ${esc(report.tool.version)}
        </div>
      </div>
      <div class="spec-metadata">
        <div class="meta-box">
          <strong>Baseline Specification</strong>
          <div>${esc(report.baseline.title || report.baseline.source)}</div>
          <div class="meta-code">SHA: ${esc(report.baseline.sha256.slice(0, 16))} (${esc(report.baseline.openapiVersion)})</div>
        </div>
        <div class="meta-box">
          <strong>Current Specification</strong>
          <div>${esc(report.current.title || report.current.source)}</div>
          <div class="meta-code">SHA: ${esc(report.current.sha256.slice(0, 16))} (${esc(report.current.openapiVersion)})</div>
        </div>
      </div>
    </header>

    <section class="stats-row">
      <div class="stat-card error">
        <div class="stat-label">Breaking Errors</div>
        <div class="stat-value">${breaking}</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-label">Warnings</div>
        <div class="stat-value">${warnings}</div>
      </div>
      <div class="stat-card info">
        <div class="stat-label">Informational</div>
        <div class="stat-value">${infos}</div>
      </div>
      <div class="stat-card total">
        <div class="stat-label">Total Changes</div>
        <div class="stat-value">${total}</div>
      </div>
    </section>

    <div class="semver-banner">
      <strong>Suggested Version Bump:</strong> ${esc(report.semver.bump.toUpperCase())} &mdash; ${esc(report.semver.reason)}
    </div>

    <section class="controls-bar">
      <input type="search" id="searchInput" class="search-input" placeholder="Search by rule, path, or message..." aria-label="Search changes">
      <div class="filter-group">
        <button class="filter-btn active" data-severity="all">All (${total})</button>
        <button class="filter-btn" data-severity="error">Errors (${breaking})</button>
        <button class="filter-btn" data-severity="warning">Warnings (${warnings})</button>
        <button class="filter-btn" data-severity="info">Info (${infos})</button>
      </div>
    </section>

    <main class="changes-list" id="changesContainer">
      ${
        report.changes.length === 0
          ? `<div class="empty-state"><h3>No contract changes detected</h3><p>The current specification is fully compatible with the baseline.</p></div>`
          : report.changes
              .map((c) => {
                const ep = endpointOf(c);
                const locStr =
                  c.location.file && c.location.line
                    ? `${c.location.file}:${c.location.line}:${c.location.column ?? 1}`
                    : c.location.pointerNew || c.location.pointerOld;
                const hasDiff = c.oldValue !== undefined || c.newValue !== undefined;
                return `
        <article class="change-card ${c.severity}" data-severity="${c.severity}" data-search="${esc(`${c.ruleId} ${ep} ${c.message} ${locStr}`).toLowerCase()}">
          <div class="change-header">
            <div class="change-title-group">
              <span class="severity-tag ${c.severity}">${c.severity}</span>
              <span class="rule-name">${esc(c.ruleId)}</span>
              <span class="endpoint-pill">${esc(ep)}</span>
            </div>
            <div class="location-info">${esc(locStr)}</div>
          </div>
          <p class="change-message">${esc(c.message)}</p>
          <div class="suggestion-box">
            <strong>Suggestion:</strong> ${esc(c.suggestion)}
          </div>
          ${
            hasDiff
              ? `<div class="diff-values">
            ${c.oldValue !== undefined ? `<div class="val-block">Old: <code>${esc(valueRepr(c.oldValue))}</code></div>` : ''}
            ${c.newValue !== undefined ? `<div class="val-block">New: <code>${esc(valueRepr(c.newValue))}</code></div>` : ''}
          </div>`
              : ''
          }
        </article>`;
              })
              .join('\n')
      }
    </main>
  </div>

  <script>
    (function() {
      const searchInput = document.getElementById('searchInput');
      const filterBtns = document.querySelectorAll('.filter-btn');
      const cards = document.querySelectorAll('.change-card');
      let currentSeverity = 'all';
      let currentQuery = '';

      function applyFilters() {
        cards.forEach(card => {
          const sev = card.getAttribute('data-severity');
          const searchData = card.getAttribute('data-search') || '';
          const matchesSev = (currentSeverity === 'all' || sev === currentSeverity);
          const matchesQuery = (!currentQuery || searchData.includes(currentQuery));
          card.style.display = (matchesSev && matchesQuery) ? '' : 'none';
        });
      }

      if (searchInput) {
        searchInput.addEventListener('input', e => {
          currentQuery = e.target.value.trim().toLowerCase();
          applyFilters();
        });
      }

      filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          filterBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentSeverity = btn.getAttribute('data-severity') || 'all';
          applyFilters();
        });
      });
    })();
  </script>
</body>
</html>`;
}
