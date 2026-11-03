/** Exit-code routing per spec §17. Everything routes through run(). */
import { ApiguardError, ExitCode, errorMessage } from '../utils/errors.js';

export { ExitCode };

/** Commander's error class (help/version/version-mismatch throw it). */
interface CommanderErrorLike {
  name: string;
  code: string;
  exitCode: number;
  message: string;
}

function isCommanderError(err: unknown): err is CommanderErrorLike {
  return (
    err instanceof Error &&
    typeof (err as CommanderErrorLike).name === 'string' &&
    (err as CommanderErrorLike).name === 'CommanderError'
  );
}

/** Map a thrown value to its exit code. Unit-tested as the §17 mapping table. */
export function exitCodeFor(err: unknown): number {
  if (isCommanderError(err)) {
    // --help / --version are successful informational exits, not usage errors (§17)
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
      return ExitCode.Ok;
    }
    return ExitCode.Usage; // Commander usage / parsing errors return ExitCode.Usage (exit code 2)
  }
  if (err instanceof ApiguardError) return err.exitCode;
  return ExitCode.Internal;
}

/** Render an error for stderr per §24 message shape. */
export function renderError(err: unknown, verbose = false): string {
  if (isCommanderError(err)) {
    // --help/--version and usage errors are informational/usage output, not internal faults;
    // commander already wrote the help/usage text via configureOutput.
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') return '';
    const cleanMsg = err.message.replace(/^error:\s*/i, '');
    return `error: ${cleanMsg}`;
  }
  if (err instanceof ApiguardError) {
    const hint = err.exitCode === ExitCode.Internal ? ' (please report this bug)' : '';
    const cleanMsg = err.message.replace(/^error:\s*/i, '');
    return `error: ${cleanMsg}${hint}${verbose && err.stack ? '\n' + err.stack : ''}`;
  }
  const cleanMsg = errorMessage(err).replace(/^error:\s*/i, '');
  return `error: unexpected internal error: ${cleanMsg} (please report this bug)`;
}
