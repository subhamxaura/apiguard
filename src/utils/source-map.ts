import { parseDocument, LineCounter } from 'yaml';
import type { ApiChange } from '../core/models/change.js';

export interface SourcePosition {
  line: number;
  column: number;
}

export class SpecSourceMap {
  private doc: ReturnType<typeof parseDocument>;
  private lineCounter: LineCounter;

  constructor(rawText: string) {
    this.lineCounter = new LineCounter();
    this.doc = parseDocument(rawText, { lineCounter: this.lineCounter });
  }

  /** Resolve 1-based line & column for a JSON pointer. */
  findPosition(pointer: string): SourcePosition | undefined {
    if (!pointer || pointer === '/') {
      return { line: 1, column: 1 };
    }
    const tokens = pointer
      .split('/')
      .filter(Boolean)
      .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));

    for (let i = tokens.length; i >= 1; i--) {
      const subTokens = tokens.slice(0, i);
      try {
        const node = this.doc.getIn(subTokens, true) as { range?: [number, number, number] } | null;
        if (node && Array.isArray(node.range) && typeof node.range[0] === 'number') {
          const pos = this.lineCounter.linePos(node.range[0]);
          return { line: pos.line, column: pos.col };
        }
      } catch {
        // Continue fallback search on parse navigation anomaly
      }
    }
    return undefined;
  }
}

/** Attach exact source file, line, and column numbers to detected changes. */
export function attachSourceLocations(
  changes: ApiChange[],
  baselineSpec: { source: string; rawText?: string },
  currentSpec: { source: string; rawText?: string },
): void {
  let currentMap: SpecSourceMap | undefined;
  let baselineMap: SpecSourceMap | undefined;

  if (currentSpec.rawText) {
    try {
      currentMap = new SpecSourceMap(currentSpec.rawText);
    } catch {
      // Best effort AST parsing
    }
  }
  if (baselineSpec.rawText) {
    try {
      baselineMap = new SpecSourceMap(baselineSpec.rawText);
    } catch {
      // Best effort AST parsing
    }
  }

  for (const c of changes) {
    if (currentMap && c.location.pointerNew) {
      const pos = currentMap.findPosition(c.location.pointerNew);
      if (pos) {
        c.location.file = currentSpec.source;
        c.location.line = pos.line;
        c.location.column = pos.column;
        continue;
      }
    }
    if (baselineMap && c.location.pointerOld) {
      const pos = baselineMap.findPosition(c.location.pointerOld);
      if (pos) {
        c.location.file = baselineSpec.source;
        c.location.line = pos.line;
        c.location.column = pos.column;
      }
    }
  }
}
