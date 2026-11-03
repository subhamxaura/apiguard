// src/reporters/junit.ts
function escapeXml(unsafe) {
  return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function renderJunit(report) {
  const breakingCount = report.summary.bySeverity.error;
  const totalTests = report.changes.length === 0 ? 1 : report.changes.length;
  const failures = breakingCount;
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuites name="API Guard" tests="${totalTests}" failures="${failures}" errors="0" time="0">`
  );
  lines.push(
    `  <testsuite name="OpenAPI Contract Changes" tests="${totalTests}" failures="${failures}" errors="0" skipped="0" time="0">`
  );
  if (report.changes.length === 0) {
    lines.push('    <testcase classname="api" name="contract-compatibility" time="0"/>');
  } else {
    for (const c of report.changes) {
      const classname = escapeXml(c.location.context);
      const name = escapeXml(
        `${c.ruleId}${c.location.method ? " " + c.location.method : ""}${c.location.path ? " " + c.location.path : ""}`
      );
      lines.push(`    <testcase classname="${classname}" name="${name}" time="0">`);
      if (c.breaking) {
        const message = escapeXml(c.message);
        const ptr = c.location.pointerNew || c.location.pointerOld || "";
        const bodyText = escapeXml(
          `Rule: ${c.ruleId}
Severity: ${c.severity}
Location: ${c.location.path} (${ptr})
Suggestion: ${c.suggestion}`
        );
        lines.push(
          `      <failure message="${message}" type="${escapeXml(c.ruleId)}">${bodyText}</failure>`
        );
      } else {
        const infoText = escapeXml(
          `[${c.severity.toUpperCase()}] ${c.message}
Suggestion: ${c.suggestion}`
        );
        lines.push(`      <system-out>${infoText}</system-out>`);
      }
      lines.push("    </testcase>");
    }
  }
  lines.push("  </testsuite>");
  lines.push("</testsuites>");
  return lines.join("\n");
}

export {
  renderJunit
};
