#!/usr/bin/env node
/** CLI bin entry per §7: the package.json `bin` points at this file's compiled output. */
import { run } from './run.js';

run().then((code) => {
  process.exitCode = code;
});
