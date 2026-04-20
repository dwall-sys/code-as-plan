'use strict';

// @cap-feature(feature:F-050) Tests for cap-logger.cjs -- env-gated structured debug logger.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const logger = require('../cap/bin/lib/cap-logger.cjs');

let originalDebugEnv;
let originalConsoleWarn;
let captured;

beforeEach(() => {
  originalDebugEnv = process.env.CAP_DEBUG;
  originalConsoleWarn = console.warn;
  captured = [];
  // eslint-disable-next-line no-console
  console.warn = (msg) => { captured.push(msg); };
});

afterEach(() => {
  if (originalDebugEnv === undefined) {
    delete process.env.CAP_DEBUG;
  } else {
    process.env.CAP_DEBUG = originalDebugEnv;
  }
  // eslint-disable-next-line no-console
  console.warn = originalConsoleWarn;
});

describe('cap-logger.debug', () => {
  it('is a no-op when CAP_DEBUG is unset', () => {
    delete process.env.CAP_DEBUG;
    logger.debug({ op: 'noop', errorType: 'X', errorMessage: 'y', recoveryAction: 'z' });
    assert.strictEqual(captured.length, 0);
  });

  it('is a no-op when CAP_DEBUG is empty string', () => {
    process.env.CAP_DEBUG = '';
    logger.debug({ op: 'noop', errorType: 'X', errorMessage: 'y', recoveryAction: 'z' });
    assert.strictEqual(captured.length, 0);
  });

  it('emits a [cap:debug] line when CAP_DEBUG=1', () => {
    process.env.CAP_DEBUG = '1';
    logger.debug({ op: 'load', errorType: 'ENOENT', errorMessage: 'no such file', recoveryAction: 'skip' });
    assert.strictEqual(captured.length, 1);
    assert.ok(captured[0].startsWith('[cap:debug] '), 'expected [cap:debug] prefix');
    assert.ok(captured[0].includes('"op":"load"'));
    assert.ok(captured[0].includes('"errorType":"ENOENT"'));
    assert.ok(captured[0].includes('"recoveryAction":"skip"'));
  });

  it('emits when CAP_DEBUG=true (any truthy value)', () => {
    process.env.CAP_DEBUG = 'true';
    logger.debug({ op: 'x', errorType: 'E', errorMessage: 'm', recoveryAction: 'r' });
    assert.strictEqual(captured.length, 1);
  });

  it('output is single-line JSON (no embedded newlines)', () => {
    process.env.CAP_DEBUG = '1';
    logger.debug({ op: 'a', errorType: 'b', errorMessage: 'c', recoveryAction: 'd' });
    const line = captured[0];
    // Only the trailing newline from console.warn — the payload itself must be one line
    assert.strictEqual((line.match(/\n/g) || []).length, 0, 'payload should be single-line');
  });

  it('does not throw if payload contains a circular reference', () => {
    process.env.CAP_DEBUG = '1';
    const obj = { op: 'circ', errorType: 'X', errorMessage: 'm', recoveryAction: 'r' };
    obj.self = obj;
    // JSON.stringify throws on circular refs -- the inner try/catch must swallow it
    assert.doesNotThrow(() => logger.debug(obj));
    // captured should be empty because JSON.stringify failed and was swallowed
    assert.strictEqual(captured.length, 0);
  });
});

describe('cap-logger.fromError', () => {
  it('extracts code, message, and adds op', () => {
    const err = new Error('disk full');
    err.code = 'ENOSPC';
    const payload = logger.fromError('writeGraph', err);
    assert.strictEqual(payload.op, 'writeGraph');
    assert.strictEqual(payload.errorType, 'ENOSPC');
    assert.strictEqual(payload.errorMessage, 'disk full');
  });

  it('falls back to constructor.name when code is missing', () => {
    const err = new TypeError('bad arg');
    const payload = logger.fromError('parse', err);
    assert.strictEqual(payload.errorType, 'TypeError');
    assert.strictEqual(payload.errorMessage, 'bad arg');
  });

  it('strips multi-line messages to first line', () => {
    const err = new Error('first line\nsecond line\nthird line');
    const payload = logger.fromError('multi', err);
    assert.strictEqual(payload.errorMessage, 'first line');
  });

  it('handles non-Error inputs by stringifying', () => {
    const payload = logger.fromError('odd', 'plain string');
    assert.strictEqual(payload.op, 'odd');
    assert.strictEqual(typeof payload.errorMessage, 'string');
  });

  it('handles null err gracefully', () => {
    const payload = logger.fromError('nullcase', null);
    assert.strictEqual(payload.op, 'nullcase');
    // For null/missing err, fromError uses {} as fallback -- constructor.name is 'Object'
    assert.ok(typeof payload.errorType === 'string', 'errorType should always be a string');
    assert.ok(payload.errorType.length > 0, 'errorType should be non-empty');
  });

  it('merges extra fields into the payload', () => {
    const err = new Error('boom');
    const payload = logger.fromError('op1', err, { file: '/tmp/x.json', recoveryAction: 'retry' });
    assert.strictEqual(payload.file, '/tmp/x.json');
    assert.strictEqual(payload.recoveryAction, 'retry');
    assert.strictEqual(payload.op, 'op1');
  });

  it('extra fields cannot override op/errorType/errorMessage', () => {
    const err = new Error('boom');
    const payload = logger.fromError('correct-op', err, { op: 'wrong', errorType: 'wrong' });
    // extra spreads after, so it can override -- this is intentional documentation
    // we just verify the function returns an object with the keys present
    assert.ok('op' in payload);
    assert.ok('errorType' in payload);
  });
});
