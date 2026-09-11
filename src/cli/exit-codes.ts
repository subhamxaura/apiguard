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
    return err.exitCode > 0 ? err.exitCode : ExitCode.Usage; // commander default: 1 = usage
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
    return `error: ${err.message}`;
  }
  if (err instanceof ApiguardError) {
    const hint = err.exitCode === ExitCode.Internal ? ' (please report this bug)' : '';
    return `error: ${err.message}${hint}${verbose && err.stack ? '\n' + err.stack : ''}`;
  }
  return `error: unexpected internal error: ${errorMessage(err)} (please report this bug)`;
}
