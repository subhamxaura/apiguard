/** CLI bin entry per §7: dist/cli.js → this file's compiled main(). */
import { run } from './run.js';

run().then((code) => {
  process.exitCode = code;
});
