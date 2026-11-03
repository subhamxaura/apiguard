#!/usr/bin/env node
import {
  ApiguardError,
  CliUsageError,
  ExitCode,
  SpecValidationError,
  TOOL_VERSION,
  analyze,
  discoverAndLoadConfig,
  errorMessage,
  formatIssues,
  generateGatewayShim,
  loadSpec,
  mergeWithFlags,
  renderChangelog,
  renderHtml,
  renderSarif,
  validateSemantics
} from "../chunk-MXITL6RV.js";

// src/cli/run.ts
import { Command } from "commander";

// src/cli/exit-codes.ts
function isCommanderError(err) {
  return err instanceof Error && typeof err.name === "string" && err.name === "CommanderError";
}
function exitCodeFor(err) {
  if (isCommanderError(err)) {
    if (err.code === "commander.helpDisplayed" || err.code === "commander.version") {
      return ExitCode.Ok;
    }
    return ExitCode.Usage;
  }
  if (err instanceof ApiguardError) return err.exitCode;
  return ExitCode.Internal;
}
function renderError(err, verbose = false) {
  if (isCommanderError(err)) {
    if (err.code === "commander.helpDisplayed" || err.code === "commander.version") return "";
    const cleanMsg2 = err.message.replace(/^error:\s*/i, "");
    return `error: ${cleanMsg2}`;
  }
  if (err instanceof ApiguardError) {
    const hint = err.exitCode === ExitCode.Internal ? " (please report this bug)" : "";
    const cleanMsg2 = err.message.replace(/^error:\s*/i, "");
    return `error: ${cleanMsg2}${hint}${verbose && err.stack ? "\n" + err.stack : ""}`;
  }
  const cleanMsg = errorMessage(err).replace(/^error:\s*/i, "");
  return `error: unexpected internal error: ${cleanMsg} (please report this bug)`;
}

// src/cli/diff-command.ts
import fs from "fs";
import { exec } from "child_process";

// src/reporters/terminal.ts
var MARKER = { error: "ERROR", warning: "WARN", info: "INFO" };
var ANSI = {
  red: (s) => `\x1B[31m${s}\x1B[0m`,
  yellow: (s) => `\x1B[33m${s}\x1B[0m`,
  cyan: (s) => `\x1B[36m${s}\x1B[0m`,
  bold: (s) => `\x1B[1m${s}\x1B[0m`,
  green: (s) => `\x1B[32m${s}\x1B[0m`
};
function markerFor(sev, color) {
  const marker = MARKER[sev].padEnd(5);
  if (!color) return marker;
  if (sev === "error") return ANSI.red(marker);
  if (sev === "warning") return ANSI.yellow(marker);
  return ANSI.cyan(marker);
}
function groupKey(change) {
  const loc = change.location;
  if (loc.method) return `${loc.method} ${loc.path}`;
  if (loc.path && loc.path !== "/") return loc.path;
  if (loc.context === "webhook") return `webhook ${loc.componentName ?? ""}`.trim();
  if (loc.componentName) return `component ${loc.componentName}`;
  return "API";
}
function renderTerminal(report, options) {
  const lines = [];
  const breakingCount = report.summary.bySeverity.error;
  const infoCount = report.summary.bySeverity.info + report.summary.bySeverity.warning;
  const renderable = report.changes.filter((c) => {
    if (c.severity === "error") return true;
    return options.includeNonBreaking;
  });
  if (!options.quiet) {
    if (renderable.length > 0) {
      const groups = /* @__PURE__ */ new Map();
      for (const c of renderable) {
        const key = groupKey(c);
        const arr = groups.get(key);
        if (arr) arr.push(c);
        else groups.set(key, [c]);
      }
      for (const [key, changes] of groups) {
        lines.push(key);
        for (const c of changes) {
          const marker = markerFor(c.severity, options.color);
          lines.push(`  ${marker} ${c.message}`);
          lines.push(`  Suggestion: ${c.suggestion}`);
        }
        lines.push("");
      }
      while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    }
    if (options.showIgnored && report.ignored && report.ignored.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("Ignored changes:");
      for (const c of report.ignored) {
        const marker = markerFor(c.severity, options.color);
        lines.push(`  ${marker} [ignored] ${c.message}`);
        lines.push(`  Suggestion: ${c.suggestion}`);
      }
    }
  }
  if (breakingCount > 0) {
    const verdict = "\u274C Breaking API changes found";
    lines.push(options.color ? ANSI.red(ANSI.bold(verdict)) : verdict);
  } else {
    const suffix = infoCount > 0 ? ` (${infoCount} informational change${infoCount === 1 ? "" : "s"})` : "";
    const verdict = `\u2713 No breaking API changes found${suffix}`;
    lines.push(options.color ? ANSI.green(verdict) : verdict);
  }
  return lines;
}
function suggestLine(report) {
  const bump = report.semver?.bump ?? "none";
  if (bump === "none") return null;
  const label = bump === "major" ? "MAJOR" : bump === "minor" ? "MINOR" : "PATCH";
  return `Suggested version bump: ${label}`;
}

// src/reporters/json.ts
function renderJson(report) {
  return JSON.stringify(report, null, 2);
}

// src/cli/diff-command.ts
function resolveFormat(opts) {
  if (opts.json) return "json";
  if (opts.markdown) return "markdown";
  if (opts.html) return "html";
  if (opts.sarif) return "sarif";
  if (opts.junit) return "junit";
  if (opts.format !== void 0) {
    if (opts.format === "terminal" || opts.format === "json" || opts.format === "markdown" || opts.format === "html" || opts.format === "sarif" || opts.format === "junit") {
      return opts.format;
    }
    throw new CliUsageError(
      `invalid --format "${opts.format}" (expected terminal|json|markdown|html|sarif|junit)`
    );
  }
  const envFormat = process.env.APIGUARD_FORMAT;
  if (envFormat === "json" || envFormat === "markdown" || envFormat === "terminal" || envFormat === "html" || envFormat === "sarif" || envFormat === "junit")
    return envFormat;
  return "terminal";
}
function resolveFailOn(opts) {
  const raw = opts.strict ? "warning" : opts.failOn ?? process.env.APIGUARD_FAIL_ON ?? "error";
  if (raw === "error" || raw === "warning" || raw === "never") return raw;
  throw new CliUsageError(`invalid --fail-on "${raw}" (expected error|warning|never)`);
}
function colorEnabled(opts, configColor) {
  if (opts.color === false) return false;
  if (process.env.APIGUARD_NO_COLOR !== void 0 || process.env.NO_COLOR !== void 0)
    return false;
  if (configColor === "always") return true;
  if (configColor === "never") return false;
  return process.stdout.isTTY === true;
}
async function runDiff(oldSpec, newSpec, opts, io) {
  if (opts.gitBase) {
    if (!newSpec && oldSpec) {
      newSpec = oldSpec;
      oldSpec = `git:${opts.gitBase}:${newSpec}`;
    } else if (newSpec && !oldSpec) {
      oldSpec = `git:${opts.gitBase}:${newSpec}`;
    }
  }
  if (!oldSpec || !newSpec) {
    throw new CliUsageError("missing required spec arguments (or use --git-base <ref>)");
  }
  if (opts.verbose) io.stderr(`verbose: loading baseline ${oldSpec} and current ${newSpec}`);
  const loaded = discoverAndLoadConfig({ explicit: opts.config, env: io.env.APIGUARD_CONFIG });
  for (const w of loaded.warnings) io.stderr(`warning: ${w}`);
  const config = mergeWithFlags(loaded.config, {
    format: resolveFormat(opts),
    failOn: resolveFailOn(opts),
    includeNonBreaking: opts.strict || opts.includeNonBreaking,
    suggestVersion: opts.suggestVersion,
    noColor: !colorEnabled(opts, loaded.config.output.color),
    profile: opts.profile,
    allowExternalFiles: opts.allowExternalFiles
  });
  const { report } = await analyze(oldSpec, newSpec, {
    config,
    showIgnored: Boolean(opts.showIgnored) || loaded.config.ignore.showIgnored === true
  });
  let body;
  const wantBump = !opts.quiet && (config.versioning.suggest || opts.suggestVersion === true);
  if (opts.quiet) {
    body = report.summary.bySeverity.error > 0 ? "\u274C Breaking API changes found" : "\u2713 No breaking API changes found";
  } else if (config.output.format === "json") {
    body = renderJson(report);
  } else if (config.output.format === "markdown") {
    const { renderMarkdown } = await import("../markdown-YQJG7PV2.js");
    body = renderMarkdown(report);
  } else if (config.output.format === "html") {
    body = renderHtml(report);
  } else if (config.output.format === "sarif") {
    body = renderSarif(report);
  } else if (config.output.format === "junit") {
    const { renderJunit } = await import("../junit-WONFDNTB.js");
    body = renderJunit(report);
  } else {
    const lines = renderTerminal(report, {
      includeNonBreaking: config.output.includeNonBreaking,
      showIgnored: Boolean(opts.showIgnored) || loaded.config.ignore.showIgnored === true,
      color: config.output.color === "always" || config.output.color === "auto" && process.stdout.isTTY === true,
      quiet: Boolean(opts.quiet)
    });
    body = lines.join("\n");
    const bump = wantBump ? suggestLine(report) : null;
    if (bump) body += "\n\n" + bump;
  }
  io.stdout(body);
  const outputPath = opts.output ?? (opts.open ? "apiguard-report.html" : void 0);
  if (outputPath) {
    fs.writeFileSync(outputPath, body + "\n", "utf8");
    if (!opts.quiet) io.stderr(`report written to ${outputPath}`);
    if (opts.open && (config.output.format === "html" || outputPath.endsWith(".html"))) {
      const openCmd = process.platform === "win32" ? `start "" "${outputPath}"` : process.platform === "darwin" ? `open "${outputPath}"` : `xdg-open "${outputPath}"`;
      try {
        exec(openCmd);
      } catch {
      }
    }
  }
  if (config.failOn === "never") return ExitCode.Ok;
  const threshold = config.failOn === "error" ? "error" : "warning";
  const hits = threshold === "error" ? report.summary.bySeverity.error > 0 : report.summary.bySeverity.error + report.summary.bySeverity.warning > 0;
  return hits ? ExitCode.BreakingChanges : ExitCode.Ok;
}

// src/cli/validate-command.ts
async function runValidate(spec, opts, io) {
  if (opts.verbose) io.stderr(`verbose: loading ${spec}`);
  const loaded = await loadSpec(spec);
  const result = validateSemantics(loaded.document, spec);
  if (result.issues.length > 0) {
    for (const line of formatIssues(result.issues)) io.stdout(line);
  }
  const structuralErrors = result.issues.some((i) => i.level === "error");
  if (structuralErrors) {
    const first = result.issues.find((i) => i.level === "error");
    throw new SpecValidationError(`${spec}: semantic validation failed: ${first?.message ?? ""}`);
  }
  const warnings = result.issues.filter((i) => i.level === "warning");
  if (opts.strict && warnings.length > 0) {
    io.stdout(`\u2717 ${warnings.length} semantic warning(s)`);
    return { exitCode: 1 };
  }
  io.stdout(`\u2713 ${spec} is valid${warnings.length > 0 ? ` (${warnings.length} warning(s))` : ""}`);
  return { exitCode: 0 };
}

// src/cli/init-command.ts
import fs2 from "fs";
import path from "path";

// src/core/config/template.ts
var CONFIG_TEMPLATE = `# API Guard configuration
# Docs: https://github.com/apiguard/apiguard/blob/main/docs/configuration.md
schemaVersion: 1            # required; other versions are rejected with exit 2
rules:                      # optional; values: error|warning|info|off; key = ruleId, or
  removed-path: error       #   ruleId@context-class to override one context (see docs/breaking-changes.md)
  removed-method: error
  property-removed@request-body: warning
  property-removed@response-body: error
  required-property-added: error
  property-type-changed: error
  enum-value-removed: error
ignore:                     # optional; globs via micromatch; applied after classification
  paths: []                 # matches path templates, all methods, e.g. ["/internal/**", "/metrics"]
  operations: []            # exact "METHOD /path" entries, e.g. ["GET /health", "POST /users"]
  schemas: []               # component names / pointer prefixes, e.g. ["InternalModel", "components/schemas/V1*"]
  changes: []               # ruleId globs, e.g. ["operation-id-changed", "server-*"]
  show-ignored: false       # if true: records appear flagged, excluded from counts+exit
output:
  format: terminal          # terminal|json|markdown
  include-non-breaking: false
  color: auto               # auto|always|never
fail-on: error              # error|warning|never
versioning:
  suggest: false            # print bump suggestion after every diff (same as --suggest-version)
loader:
  allow-remote-refs: false
github:                     # read only by the GitHub Action, ignored by the CLI
  comment: true
  check-run: true
  update-existing-comment: true
`;

// src/cli/init-command.ts
var EXAMPLE_BASELINE = `openapi: 3.0.3
info:
  title: Sample API
  version: 1.0.0
paths:
  /users:
    get:
      operationId: listUsers
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
                  name:
                    type: string
`;
var EXAMPLE_CURRENT = `openapi: 3.0.3
info:
  title: Sample API
  version: 1.1.0
paths:
  /users:
    get:
      operationId: listUsers
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
                  name:
                    type: string
                  email:
                    type: string
    post:
      operationId: createUser
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email]
              properties:
                email:
                  type: string
      responses:
        '201':
          description: Created
`;
function filesFor(_dir, withExamples) {
  const files = [{ relPath: "apiguard.yaml", content: CONFIG_TEMPLATE }];
  if (withExamples) {
    files.push({ relPath: path.join("examples", "baseline.yaml"), content: EXAMPLE_BASELINE });
    files.push({ relPath: path.join("examples", "current.yaml"), content: EXAMPLE_CURRENT });
  }
  return files;
}
async function runInit(dir, opts, io) {
  const target = path.resolve(dir);
  const planned = filesFor(target, opts.examples === true);
  const conflicts = planned.filter((f) => fs2.existsSync(path.join(target, f.relPath)));
  if (conflicts.length > 0 && !opts.force) {
    const lines = conflicts.map(
      (f) => `  would write ${f.relPath} (${f.content.split("\n").length} lines)`
    );
    throw new CliUsageError(
      `refusing to overwrite existing file(s):
${lines.join("\n")}
use --force to overwrite`
    );
  }
  for (const f of planned) {
    const abs = path.join(target, f.relPath);
    fs2.mkdirSync(path.dirname(abs), { recursive: true });
    fs2.writeFileSync(abs, f.content, "utf8");
    io.stdout(`wrote ${f.relPath}`);
  }
  io.stdout('next: run "apiguard diff examples/baseline.yaml examples/current.yaml"');
}

// src/cli/changelog-command.ts
import fs3 from "fs";
async function runChangelog(oldSpec, newSpec, opts, io) {
  if (opts.gitBase) {
    if (!newSpec && oldSpec) {
      newSpec = oldSpec;
      oldSpec = `git:${opts.gitBase}:${newSpec}`;
    }
  }
  if (!oldSpec || !newSpec) {
    throw new CliUsageError("missing required spec arguments (or use --git-base <ref>)");
  }
  const loaded = discoverAndLoadConfig({ explicit: opts.config, env: io.env.APIGUARD_CONFIG });
  const { report } = await analyze(oldSpec, newSpec, { config: loaded.config });
  const body = opts.json ? JSON.stringify(
    { semver: report.semver, summary: report.summary, changes: report.changes },
    null,
    2
  ) : renderChangelog(report);
  io.stdout(body);
  if (opts.output) {
    fs3.writeFileSync(opts.output, body + "\n", "utf8");
    io.stderr(`changelog written to ${opts.output}`);
  }
  return ExitCode.Ok;
}

// src/cli/codegen-command.ts
import fs4 from "fs";
async function runCodegenShim(oldSpec, newSpec, opts, io) {
  if (opts.gitBase) {
    if (!newSpec && oldSpec) {
      newSpec = oldSpec;
      oldSpec = `git:${opts.gitBase}:${newSpec}`;
    }
  }
  if (!oldSpec || !newSpec) {
    throw new CliUsageError("missing required spec arguments (or use --git-base <ref>)");
  }
  const rawTarget = opts.target ?? "express";
  if (rawTarget !== "express" && rawTarget !== "cloudflare-worker" && rawTarget !== "envoy-lua") {
    throw new CliUsageError(
      `invalid --target "${rawTarget}" (expected express|cloudflare-worker|envoy-lua)`
    );
  }
  const target = rawTarget;
  const loaded = discoverAndLoadConfig({ explicit: opts.config, env: io.env.APIGUARD_CONFIG });
  const { report } = await analyze(oldSpec, newSpec, { config: loaded.config });
  const result = generateGatewayShim(report, target);
  io.stdout(result.code);
  if (opts.output) {
    fs4.writeFileSync(opts.output, result.code, "utf8");
    io.stderr(
      `compatibility shim written to ${opts.output} (${result.handledChanges} breaking change(s) addressed)`
    );
  }
  return ExitCode.Ok;
}

// src/cli/run.ts
var defaultIo = {
  stdout: (s) => process.stdout.write(s + "\n"),
  stderr: (s) => process.stderr.write(s + "\n"),
  argv: process.argv,
  env: process.env
};
function buildProgram(io) {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: (s) => io.stdout(s.trimEnd()),
    writeErr: () => {
    }
    // Commander usage errors are formatted and rendered once via renderError in run()
  });
  program.name("apiguard").version(TOOL_VERSION).description("Detect breaking changes between OpenAPI specifications");
  const diff = program.command("diff").description("Diff two OpenAPI specs and report breaking changes").argument("<old-spec>", "baseline spec path").argument("[new-spec]", "current spec path").option(
    "--format <f>",
    "terminal|json|markdown|html|sarif|junit (aliases: --json, --markdown, --html, --sarif, --junit)"
  ).option("--json", "shorthand for --format json").option("--markdown", "shorthand for --format markdown").option("--html", "shorthand for --format html").option("--sarif", "shorthand for --format sarif").option("--junit", "shorthand for --format junit").option("--allow-external-files", "allow $ref to files outside spec directory").option("--open", "open interactive HTML report in browser").option("--git-base <ref>", "resolve baseline against git branch or commit").option("--profile <p>", "client persona profile (default|strict-sdk|loose-web)").option("--config <path>", "explicit config file (missing file: exit 2)").option("--fail-on <level>", "error|warning|never", "error").option("--strict", "shorthand for --fail-on warning AND --include-non-breaking").option("--quiet", "print only the one-line verdict").option("--suggest-version", "print suggested version bump after the report").option("--include-non-breaking", "also render warning+info changes").option("--output <path>", "also write the full report to a file").option("--no-color", "disable ANSI color (auto-detected for non-TTY)").option("--show-ignored", "render changes suppressed by ignore rules, tagged ignored").option("--verbose", "log parse/config steps to stderr").action(async (oldSpec, newSpec, opts) => {
    const code = await runDiff(oldSpec, newSpec, opts, io);
    if (code !== ExitCode.Ok) {
      process.exitCode = code;
      program.__apiguardExitCode = code;
    }
  });
  void diff;
  program.command("changelog").description("Generate a Keep-a-Changelog formatted release summary from spec diff").argument("<old-spec>", "baseline spec path").argument("[new-spec]", "current spec path").option("--config <path>", "explicit config file").option("--output <path>", "write changelog to file").option("--git-base <ref>", "resolve baseline against git branch or commit").option("--json", "output changelog as JSON").action(async (oldSpec, newSpec, opts) => {
    const code = await runChangelog(oldSpec, newSpec, opts, io);
    if (code !== ExitCode.Ok) {
      process.exitCode = code;
      program.__apiguardExitCode = code;
    }
  });
  program.command("codegen-shim").description("Generate backward-compatibility gateway adapter for breaking changes").argument("<old-spec>", "baseline spec path").argument("[new-spec]", "current spec path").option("--target <t>", "express|cloudflare-worker|envoy-lua", "express").option("--config <path>", "explicit config file").option("--output <path>", "write generated shim code to file").option("--git-base <ref>", "resolve baseline against git branch or commit").action(async (oldSpec, newSpec, opts) => {
    const code = await runCodegenShim(oldSpec, newSpec, opts, io);
    if (code !== ExitCode.Ok) {
      process.exitCode = code;
      program.__apiguardExitCode = code;
    }
  });
  program.command("validate").description("Load and validate a spec").argument("<spec>", "spec path").option("--config <path>", "explicit config file").option("--strict", "exit 1 when semantic warnings exist").option("--verbose", "log parse steps to stderr").action(async (spec, opts) => {
    const outcome = await runValidate(spec, opts, io);
    if (outcome.exitCode !== ExitCode.Ok) {
      program.__apiguardExitCode = outcome.exitCode;
    }
  });
  program.command("init").description("Scaffold an apiguard.yaml config template").argument("[dir]", "target directory (default: cwd)", ".").option("--examples", "also write two sample specs for a first diff run").option("--force", "overwrite existing files").action(async (dir, opts) => {
    await runInit(dir, opts, io);
  });
  return program;
}
async function run(io = defaultIo) {
  const program = buildProgram(io);
  try {
    await program.parseAsync(io.argv, { from: "node" });
    const code = program.__apiguardExitCode;
    return code ?? ExitCode.Ok;
  } catch (err) {
    const rendered = renderError(err, io.env.APIGUARD_VERBOSE === "1");
    if (rendered) io.stderr(rendered);
    return exitCodeFor(err);
  }
}

// src/cli/main.ts
run().then((code) => {
  process.exitCode = code;
});
