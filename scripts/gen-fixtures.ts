/**
 * Fixture generator per spec §20.3: creates baseline/current pairs for OAS 3.0 and 3.1.
 * Every fixture gets a header comment stating what it demonstrates and the expected verdict.
 * Run: pnpm gen-fixtures
 *
 * Design: schemas are composed from named blocks (no string surgery on composed docs), so
 * every generated file is independently valid YAML with unique keys.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../tests/fixtures');

const PREAMBLE = (version: string, extra = '') => `openapi: ${version}
info:
  title: Petstore API
  version: 1.0.0
${extra}paths:`;

// operation fragments (6-space indent, placed under a path item key)
const OP_GET_USERS = `    get:
      operationId: listUsers
      summary: List users
      parameters:
        - name: limit
          in: query
          required: false
          schema:
            type: integer
            default: 20
            minimum: 1
            maximum: 100
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UserList'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'`;

const OP_POST_USERS = (bodyRequired = true) => `    post:
      operationId: createUser
      requestBody:
${bodyRequired ? '        required: true\n' : ''}        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UserInput'
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'`;

// path items
const USERS_PATH = (withPost = false, postRequired = true) =>
  withPost
    ? `  /users:
${OP_GET_USERS}
${OP_POST_USERS(postRequired)}`
    : `  /users:
${OP_GET_USERS}`;

const ORDERS_GET = `  /orders:
    get:
      operationId: listOrders
      responses:
        '200':
          description: OK`;

// ---- schema building blocks ----

const SCHEMA_USER = (props: string, required: string[]) => `    User:
      type: object
${required.length > 0 ? `      required:\n${required.map((r) => `        - ${r}\n`).join('')}` : ''}${props}`;

const USER_PROPS_STD = `      properties:
        id:
          type: string
        name:
          type: string
        email:
          type: string
`;

const SCHEMA_USER_INPUT = (body: string) => `    UserInput:
      type: object
${body}`;

const USER_INPUT_STD = `      properties:
        name:
          type: string
        bio:
          type: string
        handle:
          type: string
`;

const SCHEMA_USER_LIST = (props: string) => `    UserList:
      type: object
${props}`;

const USER_LIST_STD = `      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/User'
`;

const SCHEMA_ERROR = `    Error:
      type: object
      properties:
        message:
          type: string
`;

function components(schemas: string[]): string {
  return `components:
  schemas:
${schemas.join('\n')}\n`;
}

function doc(version: string, pathItems: string, schemas: string[], servers?: string): string {
  return `${PREAMBLE(version, servers ? `servers:\n${servers}\n` : '')}
${pathItems}
${components(schemas)}`;
}

// ---- standard document builders ----

const stdSchemas = (
  overrides: {
    userProps?: string;
    userRequired?: string[];
    userInput?: string;
    userList?: string;
    extra?: string[];
  } = {},
) => {
  const list: string[] = [];
  list.push(
    SCHEMA_USER(overrides.userProps ?? USER_PROPS_STD, overrides.userRequired ?? ['id', 'name']),
  );
  if (overrides.userInput !== null)
    list.push(SCHEMA_USER_INPUT(overrides.userInput ?? USER_INPUT_STD));
  if (overrides.userList !== null) list.push(SCHEMA_USER_LIST(overrides.userList ?? USER_LIST_STD));
  list.push(SCHEMA_ERROR);
  if (overrides.extra) list.push(...overrides.extra);
  return list;
};

const BASE = (v: string) => doc(v, USERS_PATH(), stdSchemas());
const BASE_BOTH = (v: string) => doc(v, USERS_PATH(true), stdSchemas());

interface Pair {
  name: string;
  note: string;
  baseline: string;
  current: string;
}

const PAYMENT_ONEOF = `    Payment:
      oneOf:
        - type: object
          properties:
            card:
              type: string
        - type: object
          properties:
            cash:
              type: string
`;

const PAYMENT_ONEOF_ONE = `    Payment:
      oneOf:
        - type: object
          properties:
            card:
              type: string
`;

const NODE_CIRCULAR = `    Node:
      type: object
      properties:
        next:
          $ref: '#/components/schemas/Node'
`;

const NODE_CIRCULAR_LABEL = `    Node:
      type: object
      properties:
        next:
          $ref: '#/components/schemas/Node'
        label:
          type: string
`;

const CASES: Pair[] = [
  {
    name: 'no-changes',
    note: 'no changes; expect: no breaking changes, zero changes',
    baseline: BASE('3.0.3'),
    current: BASE('3.0.3'),
  },
  {
    name: 'endpoint-added',
    note: 'endpoint added; expect: no breaking (operation-added info, minor)',
    baseline: BASE('3.0.3'),
    current: doc('3.0.3', `${USERS_PATH()}\n${ORDERS_GET}`, stdSchemas()),
  },
  {
    name: 'endpoint-removed',
    note: 'endpoint removed; expect: BREAKING (removed-path error, major)',
    baseline: doc('3.0.3', `${USERS_PATH()}\n${ORDERS_GET}`, stdSchemas()),
    current: BASE('3.0.3'),
  },
  {
    name: 'operationid-changed',
    note: 'operationId changed; expect: no breaking (operation-id-changed warning)',
    baseline: BASE('3.0.3'),
    current: doc(
      '3.0.3',
      USERS_PATH().replace('operationId: listUsers', 'operationId: listUsersV2'),
      stdSchemas(),
    ),
  },
  {
    name: 'required-request-property-added',
    note: 'required request property added; expect: BREAKING (required-property-added error, send side)',
    baseline: BASE_BOTH('3.0.3'),
    current: doc(
      '3.0.3',
      USERS_PATH(true),
      stdSchemas({
        userInput: `      required:\n        - handle\n      properties:\n        handle:\n          type: string\n`,
      }),
    ),
  },
  {
    name: 'optional-request-property-added',
    note: 'optional request property added; expect: no breaking (property-added info)',
    baseline: doc(
      '3.0.3',
      USERS_PATH(true),
      stdSchemas({
        userInput: `      properties:\n        handle:\n          type: string\n`,
      }),
    ),
    current: doc(
      '3.0.3',
      USERS_PATH(true),
      stdSchemas({
        userInput: `      properties:\n        handle:\n          type: string\n        nickname:\n          type: string\n`,
      }),
    ),
  },
  {
    name: 'optional-to-required-request-property',
    note: 'optional→required property on request body; expect: BREAKING (required-property-added error)',
    baseline: doc(
      '3.0.3',
      USERS_PATH(true),
      stdSchemas({
        userInput: `      properties:\n        bio:\n          type: string\n`,
      }),
    ),
    current: doc(
      '3.0.3',
      USERS_PATH(true),
      stdSchemas({
        userInput: `      required:\n        - bio\n      properties:\n        bio:\n          type: string\n`,
      }),
    ),
  },
  {
    name: 'request-property-removed-warning',
    note: 'optional request property removed; expect: no breaking (property-removed warning, send side)',
    baseline: doc(
      '3.0.3',
      USERS_PATH(true),
      stdSchemas({
        userInput: `      properties:\n        nickname:\n          type: string\n`,
      }),
    ),
    current: doc(
      '3.0.3',
      USERS_PATH(true),
      stdSchemas({
        userInput: `      properties: {}\n`,
      }),
    ),
  },
  {
    name: 'response-property-removed',
    note: 'response property removed; expect: BREAKING (property-removed error, parse side)',
    baseline: doc(
      '3.0.3',
      USERS_PATH(),
      stdSchemas({
        userList: `      properties:\n        items:\n          type: array\n          items:\n            $ref: '#/components/schemas/User'\n        totalCount:\n          type: integer\n`,
      }),
    ),
    current: BASE('3.0.3'),
  },
  {
    name: 'property-type-changed',
    note: 'property type changed; expect: BREAKING (property-type-changed error)',
    baseline: BASE('3.0.3'),
    current: doc(
      '3.0.3',
      USERS_PATH(),
      stdSchemas({
        userProps: USER_PROPS_STD.replace(
          '        id:\n          type: string',
          '        id:\n          type: integer',
        ),
      }),
    ),
  },
  {
    name: 'format-changed',
    note: 'format changed; expect: no breaking (property-format-changed warning)',
    baseline: doc(
      '3.0.3',
      USERS_PATH(),
      stdSchemas({
        userProps: USER_PROPS_STD.replace(
          '        email:\n          type: string',
          '        email:\n          type: string\n          format: email',
        ),
      }),
    ),
    current: doc(
      '3.0.3',
      USERS_PATH(),
      stdSchemas({
        userProps: USER_PROPS_STD.replace(
          '        email:\n          type: string',
          '        email:\n          type: string\n          format: uri',
        ),
      }),
    ),
  },
  {
    name: 'enum-value-removed',
    note: 'enum value removed; expect: BREAKING (enum-value-removed error)',
    baseline: doc(
      '3.0.3',
      USERS_PATH(),
      stdSchemas({
        userProps: USER_PROPS_STD.replace(
          '        name:\n          type: string',
          '        name:\n          type: string\n          enum: [alice, bob]',
        ),
      }),
    ),
    current: doc(
      '3.0.3',
      USERS_PATH(),
      stdSchemas({
        userProps: USER_PROPS_STD.replace(
          '        name:\n          type: string',
          '        name:\n          type: string\n          enum: [alice]',
        ),
      }),
    ),
  },
  {
    name: 'enum-value-added',
    note: 'enum value added; expect: no breaking (enum-value-added info)',
    baseline: doc(
      '3.0.3',
      USERS_PATH(),
      stdSchemas({
        userProps: USER_PROPS_STD.replace(
          '        name:\n          type: string',
          '        name:\n          type: string\n          enum: [alice]',
        ),
      }),
    ),
    current: doc(
      '3.0.3',
      USERS_PATH(),
      stdSchemas({
        userProps: USER_PROPS_STD.replace(
          '        name:\n          type: string',
          '        name:\n          type: string\n          enum: [alice, bob]',
        ),
      }),
    ),
  },
  {
    name: 'response-status-removed',
    note: 'default response removed; expect: BREAKING (default-response-removed error)',
    baseline: BASE('3.0.3'),
    current: doc(
      '3.0.3',
      USERS_PATH().replace(
        / {8}default:\n {10}description: Error\n {10}content:\n {12}application\/json:\n {14}schema:\n {16}\$ref: '#\/components\/schemas\/Error'/,
        '',
      ),
      stdSchemas(),
    ),
  },
  {
    name: 'constraint-tightened',
    note: 'constraint tightened (minimum 1→10); expect: BREAKING (constraint-tightened error)',
    baseline: BASE('3.0.3'),
    current: doc(
      '3.0.3',
      USERS_PATH().replace('            minimum: 1', '            minimum: 10'),
      stdSchemas(),
    ),
  },
  {
    name: 'constraint-relaxed',
    note: 'constraint relaxed (maximum 100→1000); expect: no breaking (constraint-relaxed info)',
    baseline: BASE('3.0.3'),
    current: doc(
      '3.0.3',
      USERS_PATH().replace('            maximum: 100', '            maximum: 1000'),
      stdSchemas(),
    ),
  },
  {
    name: 'required-array-shrunk',
    note: 'required array shrunk; expect: no breaking (required-removed info relaxation)',
    baseline: BASE('3.0.3'),
    current: doc('3.0.3', USERS_PATH(), stdSchemas({ userRequired: ['id'] })),
  },
  {
    name: 'additionalproperties-closed',
    note: 'additionalProperties closed; expect: BREAKING (map-closed error)',
    baseline: BASE('3.0.3'),
    current: doc(
      '3.0.3',
      USERS_PATH(),
      stdSchemas({ userProps: USER_PROPS_STD + '      additionalProperties: false\n' }),
    ),
  },
  {
    name: 'allof-member-added',
    note: 'allOf member added; expect: no breaking (allOf-member-added warning)',
    baseline: BASE('3.0.3'),
    current: doc(
      '3.0.3',
      USERS_PATH(),
      stdSchemas({
        userProps:
          USER_PROPS_STD +
          '      allOf:\n        - type: object\n          properties:\n            extra:\n              type: string\n',
      }),
    ),
  },
  {
    name: 'oneof-member-removed',
    note: 'oneOf member removed; expect: BREAKING (anyOf-oneOf-member-removed error)',
    baseline: doc('3.0.3', USERS_PATH(), stdSchemas({ extra: [PAYMENT_ONEOF] })),
    current: doc('3.0.3', USERS_PATH(), stdSchemas({ extra: [PAYMENT_ONEOF_ONE] })),
  },
  {
    name: 'discriminator-added',
    note: 'discriminator added; expect: no breaking (discriminator-added warning)',
    baseline: BASE('3.0.3'),
    current: doc(
      '3.0.3',
      USERS_PATH(),
      stdSchemas({
        userProps: USER_PROPS_STD + '      discriminator:\n        propertyName: kind\n',
      }),
    ),
  },
  {
    name: 'readonly-flip',
    note: 'readOnly flip; expect: request-view treats id as server-generated (property-removed warning on request side per §11.5)',
    baseline: doc('3.0.3', USERS_PATH(true), stdSchemas()),
    current: doc(
      '3.0.3',
      USERS_PATH(true),
      stdSchemas({
        userProps: USER_PROPS_STD.replace(
          '        id:\n          type: string',
          '        id:\n          type: string\n          readOnly: true',
        ),
      }),
    ),
  },
  {
    name: 'server-url-removed',
    note: 'server URL removed; expect: BREAKING (server-url-removed error)',
    baseline: doc(
      '3.0.3',
      USERS_PATH(),
      stdSchemas(),
      '  - url: https://api.example.com/v1\n  - url: https://api.example.com/v2',
    ),
    current: doc('3.0.3', USERS_PATH(), stdSchemas(), '  - url: https://api.example.com/v1'),
  },
  {
    name: 'server-url-added',
    note: 'server URL added; expect: no breaking (server-url-added info)',
    baseline: doc('3.0.3', USERS_PATH(), stdSchemas(), '  - url: https://api.example.com/v1'),
    current: doc(
      '3.0.3',
      USERS_PATH(),
      stdSchemas(),
      '  - url: https://api.example.com/v1\n  - url: https://api.example.com/v2',
    ),
  },
  {
    name: 'description-only-change',
    note: 'description-only change; expect: no breaking, patch (operation-description-changed info)',
    baseline: BASE('3.0.3'),
    current: doc(
      '3.0.3',
      USERS_PATH().replace(
        '      summary: List users',
        '      summary: List users\n      description: Returns a paginated list',
      ),
      stdSchemas(),
    ),
  },
  {
    name: 'parameter-made-required',
    note: 'parameter made required; expect: BREAKING (parameter-made-required error)',
    baseline: BASE('3.0.3'),
    current: doc(
      '3.0.3',
      USERS_PATH().replace(
        '        - name: limit\n          in: query\n          required: false',
        '        - name: limit\n          in: query\n          required: true',
      ),
      stdSchemas(),
    ),
  },
  {
    name: 'request-body-removed',
    note: 'request body removed (was required); expect: BREAKING (request-body-removed error)',
    baseline: BASE_BOTH('3.0.3'),
    current: BASE('3.0.3'),
  },
  {
    name: 'request-body-removed-optional-warning',
    note: 'optional request body removed; expect: no breaking (request-body-removed warning, send side)',
    baseline: doc('3.0.3', USERS_PATH(true, false), stdSchemas()),
    current: BASE('3.0.3'),
  },
  {
    name: 'circular-refs-pair',
    note: 'circular refs pair; expect: terminates, no breaking',
    baseline: doc('3.0.3', USERS_PATH(), stdSchemas({ extra: [NODE_CIRCULAR] })),
    current: doc('3.0.3', USERS_PATH(), stdSchemas({ extra: [NODE_CIRCULAR_LABEL] })),
  },
  {
    name: 'yaml-reorder-quote-changes-only',
    note: 'YAML reorder + quote changes only; expect: zero changes (semantic identity)',
    baseline: BASE('3.0.3'),
    current: `openapi: "3.0.3"
info:
  version: 1.0.0
  title: "Petstore API"
paths:
  /users:
    get:
      responses:
        default:
          description: Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserList"
      operationId: listUsers
      summary: List users
      parameters:
        - name: limit
          in: query
          required: false
          schema:
            type: integer
            default: 20
            minimum: 1
            maximum: 100
components:
  schemas:
    Error:
      type: object
      properties:
        message:
          type: string
    UserList:
      type: object
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/User'
    User:
      required:
        - id
        - name
      type: object
      properties:
        email:
          type: string
        name:
          type: string
        id:
          type: string
`,
  },
];

function to31(yaml: string): string {
  return yaml.split('openapi: 3.0.3').join('openapi: 3.1.0');
}

const CASES_31: Pair[] = CASES.map((c) => ({
  name: c.name,
  note: c.note,
  baseline: to31(c.baseline),
  current: to31(c.current),
}));

const CROSS = {
  name: '3.0-baseline-3.1-current-nullable-parity',
  note: '3.0 baseline vs 3.1 current with nullable parity; expect: zero changes (§11.2)',
  baseline: `openapi: 3.0.3
info:
  title: Petstore API
  version: 1.0.0
paths:
  /ping:
    get:
      operationId: ping
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  message:
                    type: string
                    nullable: true
`,
  current: `openapi: 3.1.0
info:
  title: Petstore API
  version: 1.0.0
paths:
  /ping:
    get:
      operationId: ping
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  message:
                    type: [string, 'null']
`,
};

function write(dir: string, name: string, note: string, baseline: string, current: string): void {
  const caseDir = path.join(dir, name);
  fs.mkdirSync(caseDir, { recursive: true });
  const header = (which: string) =>
    `# Fixture: ${name} (${which})\n# Demonstrates: ${note}\n# Generated by scripts/gen-fixtures.ts — do not edit by hand.\n`;
  const nl = (s: string) => (s.endsWith('\n') ? s : s + '\n');
  fs.writeFileSync(path.join(caseDir, 'baseline.yaml'), header('baseline') + nl(baseline));
  fs.writeFileSync(path.join(caseDir, 'current.yaml'), header('current') + nl(current));
}

function writeExternalPair(): void {
  const extDir = path.join(ROOT, '3.0', 'file-external-ref-pair');
  fs.mkdirSync(extDir, { recursive: true });
  fs.writeFileSync(
    path.join(extDir, 'common.yaml'),
    `components:\n  schemas:\n    Shared:\n      type: object\n      properties:\n        id:\n          type: string\n`,
  );
  const spec = `openapi: 3.0.3
info:
  title: Petstore API
  version: 1.0.0
paths:
  /shared:
    get:
      operationId: getShared
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: 'common.yaml#/components/schemas/Shared'
`;
  fs.writeFileSync(
    path.join(extDir, 'baseline.yaml'),
    `# Fixture: external-file $ref (denied in v1 — expect exit 3)\n` + spec,
  );
  fs.writeFileSync(
    path.join(extDir, 'current.yaml'),
    `# Fixture: external-file $ref (denied in v1 — expect exit 3)\n` + spec,
  );
}

// ---------- run ----------

for (const ver of ['3.0', '3.1'] as const) {
  fs.rmSync(path.join(ROOT, ver), { recursive: true, force: true });
}
fs.rmSync(path.join(ROOT, 'cross-version'), { recursive: true, force: true });

for (const ver of ['3.0', '3.1'] as const) {
  const cases = ver === '3.0' ? CASES : CASES_31;
  for (const c of cases) {
    write(path.join(ROOT, ver), c.name, c.note, c.baseline, c.current);
  }
}
write(path.join(ROOT, 'cross-version'), CROSS.name, CROSS.note, CROSS.baseline, CROSS.current);
writeExternalPair();

console.log('fixtures generated');
