/** `apiguard init` per spec §13. */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_TEMPLATE } from '../core/config/template.js';
import { CliUsageError } from '../utils/errors.js';
import type { CliIo } from './run.js';

const EXAMPLE_BASELINE = `openapi: 3.0.3
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

const EXAMPLE_CURRENT = `openapi: 3.0.3
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

interface InitFile {
  relPath: string;
  content: string;
}

function filesFor(_dir: string, withExamples: boolean): InitFile[] {
  const files: InitFile[] = [{ relPath: 'apiguard.yaml', content: CONFIG_TEMPLATE }];
  if (withExamples) {
    files.push({ relPath: path.join('examples', 'baseline.yaml'), content: EXAMPLE_BASELINE });
    files.push({ relPath: path.join('examples', 'current.yaml'), content: EXAMPLE_CURRENT });
  }
  return files;
}

export async function runInit(
  dir: string,
  opts: { examples?: boolean; force?: boolean },
  io: CliIo,
): Promise<void> {
  const target = path.resolve(dir);
  const planned = filesFor(target, opts.examples === true);

  const conflicts = planned.filter((f) => fs.existsSync(path.join(target, f.relPath)));
  if (conflicts.length > 0 && !opts.force) {
    const lines = conflicts.map(
      (f) => `  would write ${f.relPath} (${f.content.split('\n').length} lines)`,
    );
    throw new CliUsageError(
      `refusing to overwrite existing file(s):\n${lines.join('\n')}\nuse --force to overwrite`,
    );
  }

  for (const f of planned) {
    const abs = path.join(target, f.relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, 'utf8');
    io.stdout(`wrote ${f.relPath}`);
  }
  io.stdout('next: run "apiguard diff examples/baseline.yaml examples/current.yaml"');
}
