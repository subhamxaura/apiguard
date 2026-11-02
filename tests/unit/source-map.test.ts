import { describe, it, expect } from 'vitest';
import { SpecSourceMap, attachSourceLocations } from '../../src/utils/source-map.js';
import type { ApiChange } from '../../src/core/models/change.js';

const SAMPLE_YAML = `openapi: 3.0.3
info:
  title: Users API
  version: 1.0.0
paths:
  /users:
    get:
      summary: List users
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

describe('SpecSourceMap', () => {
  it('resolves exact line and column for existing path pointer', () => {
    const sm = new SpecSourceMap(SAMPLE_YAML);
    const pos = sm.findPosition('/paths/~1users/get');
    expect(pos).toBeDefined();
    expect(pos?.line).toBe(8);
  });

  it('resolves exact line and column for deep property pointer', () => {
    const sm = new SpecSourceMap(SAMPLE_YAML);
    const pos = sm.findPosition(
      '/paths/~1users/get/responses/200/content/application~1json/schema/properties/name',
    );
    expect(pos).toBeDefined();
    expect(pos?.line).toBe(20);
  });

  it('falls back to parent node when leaf property does not exist', () => {
    const sm = new SpecSourceMap(SAMPLE_YAML);
    const pos = sm.findPosition(
      '/paths/~1users/get/responses/200/content/application~1json/schema/properties/nonexistent',
    );
    expect(pos).toBeDefined();
    // Falls back to properties object at line 17
    expect(pos?.line).toBe(17);
  });

  it('returns line 1 column 1 for root pointer', () => {
    const sm = new SpecSourceMap(SAMPLE_YAML);
    const pos = sm.findPosition('/');
    expect(pos).toEqual({ line: 1, column: 1 });
  });

  it('attaches source locations to ApiChange array', () => {
    const changes: ApiChange[] = [
      {
        id: '1',
        ruleId: 'property-removed',
        severity: 'error',
        kind: 'removal',
        breaking: true,
        message: 'Property `id` was removed',
        suggestion: 'Keep id',
        location: {
          path: '/users',
          context: 'response-body',
          pointerOld:
            '/paths/~1users/get/responses/200/content/application~1json/schema/properties/id',
          pointerNew: '',
        },
      },
      {
        id: '2',
        ruleId: 'operation-summary-changed',
        severity: 'info',
        kind: 'documentation',
        breaking: false,
        message: 'Summary changed',
        suggestion: 'Ok',
        location: {
          path: '/users',
          context: 'operation',
          pointerOld: '/paths/~1users/get/summary',
          pointerNew: '/paths/~1users/get/summary',
        },
      },
    ];

    attachSourceLocations(
      changes,
      { source: 'old.yaml', rawText: SAMPLE_YAML },
      { source: 'new.yaml', rawText: SAMPLE_YAML },
    );

    // Change 1 (removal): should be located via baseline old.yaml
    expect(changes[0]!.location.file).toBe('old.yaml');
    expect(changes[0]!.location.line).toBe(18);

    // Change 2 (modification): should be located via current new.yaml
    expect(changes[1]!.location.file).toBe('new.yaml');
    expect(changes[1]!.location.line).toBe(8);
  });
});
