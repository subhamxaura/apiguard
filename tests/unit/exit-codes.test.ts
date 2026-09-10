import { describe, it, expect } from 'vitest';
import { exitCodeFor, renderError } from '../../src/cli/exit-codes.js';
import {
  CliUsageError,
  ConfigError,
  SpecLoadError,
  SpecValidationError,
  InternalError,
} from '../../src/utils/errors.js';

describe('exit-code mapping (§17)', () => {
  it('maps error classes to their exit codes', () => {
    expect(exitCodeFor(new CliUsageError('bad args'))).toBe(2);
    expect(exitCodeFor(new ConfigError('bad config'))).toBe(2);
    expect(exitCodeFor(new SpecLoadError('parse fail'))).toBe(3);
    expect(exitCodeFor(new SpecValidationError('invalid spec'))).toBe(3);
    expect(exitCodeFor(new InternalError('boom'))).toBe(4);
    expect(exitCodeFor(new Error('unknown'))).toBe(4);
    expect(exitCodeFor('string error')).toBe(4);
  });
});

describe('renderError', () => {
  it('prefixes known errors without stack', () => {
    const out = renderError(new CliUsageError('bad'));
    expect(out).toBe('error: bad');
  });
  it('invites bug reports for internal errors', () => {
    const out = renderError(new InternalError('boom'));
    expect(out).toContain('please report this bug');
  });
});
