// src/reporters/markdown.ts
var LABEL = {
  error: "Breaking (errors)",
  warning: "Warnings",
  info: "Informational"
};
function truncate(s, max = 140) {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}
function endpointOf(change) {
  const loc = change.location;
  if (loc.method) return `${loc.method} ${loc.path}`;
  if (loc.path && loc.path !== "/") return loc.path;
  if (loc.componentName) return loc.componentName;
  return "API";
}
function renderMarkdown(report) {
  const lines = [];
  const breaking = report.summary.bySeverity.error;
  lines.push(
    breaking > 0 ? `## \u274C API Guard: ${breaking} breaking change${breaking === 1 ? "" : "s"} found` : "## \u2705 API Guard: no breaking changes"
  );
  lines.push("");
  lines.push("| Rule | Severity | Endpoint | What changed | Suggestion |");
  lines.push("|---|---|---|---|---|");
  for (const c of report.changes) {
    lines.push(
      `| \`${c.ruleId}\` | ${c.severity} | ${endpointOf(c)} | ${truncate(c.message.replace(/\|/g, "\\|"))} | ${truncate(c.suggestion.replace(/\|/g, "\\|"))} |`
    );
  }
  for (const sev of ["error", "warning", "info"]) {
    const group = report.changes.filter((c) => c.severity === sev);
    if (group.length === 0) continue;
    lines.push("");
    lines.push(`<details>`);
    lines.push(`<summary>${LABEL[sev]} (${group.length})</summary>`);
    lines.push("");
    for (const c of group) {
      lines.push(`#### \`${c.ruleId}\` \u2014 ${endpointOf(c)}`);
      lines.push("");
      lines.push(c.message);
      lines.push("");
      lines.push(`> **Suggestion:** ${c.suggestion}`);
      lines.push("");
    }
    lines.push(`</details>`);
  }
  if (report.ignored && report.ignored.length > 0) {
    lines.push("");
    lines.push(`<details>`);
    lines.push(`<summary>Ignored changes (${report.ignored.length})</summary>`);
    lines.push("");
    for (const c of report.ignored) {
      lines.push(`- [ignored] \`${c.ruleId}\` \u2014 ${c.message}`);
    }
    lines.push("");
    lines.push(`</details>`);
  }
  lines.push("");
  lines.push(
    `<sub>apiguard v${report.tool.version} \xB7 baseline ${report.baseline.sha256.slice(0, 8)} \u2192 current ${report.current.sha256.slice(0, 8)}</sub>`
  );
  return lines.join("\n");
}
function markdownBumpLine(report) {
  const bump = report.semver.bump;
  if (bump === "none") return null;
  const label = bump === "major" ? "MAJOR" : bump === "minor" ? "MINOR" : "PATCH";
  return `Suggested version bump: ${label}`;
}
export {
  markdownBumpLine,
  renderMarkdown
};
