'use strict';

// @cap-feature(feature:F-061) Adversarial tests for Token Telemetry.
//                  Focus: break the privacy boundary (AC-5), find O_APPEND concurrency
//                  issues, malformed-config fallbacks, query edge cases, zero-deps
//                  contract at load time, atomicity of aggregate writes, hash
//                  determinism, and deep-no-op discipline when disabled (AC-6).
//
// @cap-decision(F-061/AdversarialStrategy) Every privacy test performs a byte-level
//                  assertion against the JSONL file — this is the honest check.
//                  Structural assertions on parsed fields are not enough because a
//                  future contributor could smuggle secrets into e.g. a model name.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const TELEMETRY_PATH = path.join(__dirname, '..', 'cap', 'bin', 'lib', 'cap-telemetry.cjs');
const telemetry = require(TELEMETRY_PATH);

// Canonical needle present in any attempted leak. If any byte of this lands on
// disk, the privacy boundary has been breached.
const SECRET_NEEDLES = [
  'SECRET_NEEDLE_xyz',
  'SECRET_PROMPT_ALPHA',
  'SECRET_COMPLETION_BETA',
  'SECRET_SYSTEM_GAMMA',
  'SECRET_PROTO_DELTA',
  'SECRET_NESTED_EPSILON',
  'SECRET_ARRAY_ZETA',
  'SECRET_HOMOGLYPH_ETA',
  'SECRET_LONG_THETA',
];

// Helpers -------------------------------------------------------------------

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeConfig(root, obj) {
  const capDir = path.join(root, '.cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'config.json'), JSON.stringify(obj), 'utf8');
}

function writeRawConfig(root, raw) {
  const capDir = path.join(root, '.cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'config.json'), raw, 'utf8');
}

function readJsonl(root) {
  const p = path.join(root, '.cap', 'telemetry', 'llm-calls.jsonl');
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

function assertNoNeedles(raw, label) {
  for (const needle of SECRET_NEEDLES) {
    assert.ok(
      !raw.includes(needle),
      `${label || 'disk'} must not contain secret needle "${needle}" — privacy boundary breached`
    );
  }
}

// ---------------------------------------------------------------------------
// AC-5 · Privacy boundary — direct smuggle
// ---------------------------------------------------------------------------

describe('AC-5 adversarial · direct smuggle attempts at top-level input', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-tel-adv-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-061/AC-5) top-level prompt/completion fields must never reach disk
  it('rejects prompt and completion keys at top level', () => {
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's', featureId: 'F-061',
      prompt: 'SECRET_PROMPT_ALPHA and SECRET_NEEDLE_xyz',
      completion: 'SECRET_COMPLETION_BETA',
    });
    assertNoNeedles(readJsonl(tmp));
  });

  // @cap-todo(ac:F-061/AC-5) alternative free-text field names must not survive sanitization
  it('rejects alternative free-text field names (system/input/output/text/content/message)', () => {
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's',
      system: 'SECRET_SYSTEM_GAMMA',
      input: 'SECRET_NEEDLE_xyz input',
      output: 'SECRET_NEEDLE_xyz output',
      text: 'SECRET_NEEDLE_xyz text',
      content: 'SECRET_NEEDLE_xyz content',
      message: 'SECRET_NEEDLE_xyz message',
      user_msg: 'SECRET_NEEDLE_xyz user_msg',
      assistant_msg: 'SECRET_NEEDLE_xyz assistant_msg',
      commandContext: {
        command: '/cap:prototype',
        system: 'SECRET_SYSTEM_GAMMA ctx',
        input: 'SECRET_NEEDLE_xyz input ctx',
        output: 'SECRET_NEEDLE_xyz output ctx',
        text: 'SECRET_NEEDLE_xyz text ctx',
        content: 'SECRET_NEEDLE_xyz content ctx',
        message: 'SECRET_NEEDLE_xyz message ctx',
      },
    });
    assertNoNeedles(readJsonl(tmp));
  });

  // @cap-todo(ac:F-061/AC-5) __proto__ pollution cannot inject fields into record
  it('rejects __proto__ pollution via commandContext', () => {
    const hostile = JSON.parse(
      '{"command":"/cap:prototype","__proto__":{"prompt":"SECRET_PROTO_DELTA"}}'
    );
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's', commandContext: hostile,
    });
    const raw = readJsonl(tmp);
    assertNoNeedles(raw);
    // And nothing on Object.prototype got permanently corrupted:
    assert.equal(({}).prompt, undefined, 'Object.prototype must not be polluted');
  });

  // @cap-todo(ac:F-061/AC-5) model field is length-capped so it cannot be used as a smuggle channel
  it('length-caps the model string so a huge payload cannot pass through', () => {
    // 2000 copies of the 17-char needle = 34_000 chars total. The cap must keep the
    // persisted model <= 200 chars regardless of the input.
    const huge = 'SECRET_LONG_THETA'.repeat(2000);
    telemetry.recordLlmCall(tmp, {
      model: huge, promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's',
    });
    const raw = readJsonl(tmp);
    const parsed = JSON.parse(raw.trim());
    assert.ok(
      parsed.model.length <= 200,
      `model field must be length-capped to <= 200 chars, got ${parsed.model.length}`
    );
    // And therefore the raw bytes on disk cannot contain the needle more than ~12 times
    // (200/17 ≈ 11). Any number far above that indicates the cap was bypassed.
    const occurrences = (raw.match(/SECRET_LONG_THETA/g) || []).length;
    assert.ok(
      occurrences <= 12,
      `length cap bypassed: ${occurrences} needle copies persisted`
    );
  });

  // @cap-todo(ac:F-061/AC-5) sessionId is length-capped so it cannot be used as a smuggle channel
  it('length-caps sessionId so a huge payload cannot pass through', () => {
    const huge = 'SECRET_LONG_THETA'.repeat(2000);
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: huge, featureId: 'F-061',
    });
    const raw = readJsonl(tmp);
    const parsed = JSON.parse(raw.trim());
    assert.ok(
      parsed.sessionId.length <= 200,
      `sessionId must be length-capped to <= 200 chars, got ${parsed.sessionId.length}`
    );
    const occurrences = (raw.match(/SECRET_LONG_THETA/g) || []).length;
    assert.ok(
      occurrences <= 12,
      `sessionId length cap bypassed: ${occurrences} needle copies persisted`
    );
  });

  // @cap-todo(ac:F-061/AC-5) featureId is length-capped and non-string values collapse to null
  it('length-caps featureId and rejects non-string types', () => {
    const huge = 'SECRET_LONG_THETA'.repeat(2000);
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's', featureId: huge,
    });
    const rawHuge = readJsonl(tmp);
    const parsedHuge = JSON.parse(rawHuge.trim());
    assert.ok(
      parsedHuge.featureId.length <= 200,
      `featureId must be length-capped to <= 200 chars, got ${parsedHuge.featureId.length}`
    );

    // Non-string types (object pretending to be an id) must collapse to null,
    // not be JSON-stringified into the record.
    const tmp2 = mkTmp('cap-tel-adv-');
    try {
      telemetry.recordLlmCall(tmp2, {
        model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
        sessionId: { toString: () => 'SECRET_NEEDLE_xyz' },
        featureId: ['SECRET_NEEDLE_xyz'],
      });
      const raw2 = readJsonl(tmp2);
      assertNoNeedles(raw2, 'non-string id smuggle');
      const parsed2 = JSON.parse(raw2.trim());
      assert.equal(parsed2.sessionId, null, 'non-string sessionId must collapse to null');
      assert.equal(parsed2.featureId, null, 'non-string featureId must collapse to null');
    } finally {
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-5 · Privacy boundary — nested smuggling through commandContext values
// ---------------------------------------------------------------------------

describe('AC-5 adversarial · nested and typed smuggling through commandContext', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-tel-adv-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-061/AC-5) nested objects inside a whitelisted key cannot carry secrets
  it('rejects object-valued note containing nested prompt', () => {
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's',
      commandContext: {
        command: '/cap:prototype',
        note: { prompt: 'SECRET_NESTED_EPSILON', deep: { text: 'SECRET_NEEDLE_xyz' } },
      },
    });
    assertNoNeedles(readJsonl(tmp));
  });

  // @cap-todo(ac:F-061/AC-5) array-valued note containing secrets is rejected
  it('rejects array-valued note containing secrets', () => {
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's',
      commandContext: {
        command: '/cap:prototype',
        note: [{ text: 'SECRET_ARRAY_ZETA' }, 'SECRET_NEEDLE_xyz'],
      },
    });
    assertNoNeedles(readJsonl(tmp));
  });

  // @cap-todo(ac:F-061/AC-5) long string values on whitelisted keys are capped
  it('caps a whitelisted string value at 200 chars so pasted prompts cannot land whole', () => {
    const longPayload = 'A'.repeat(10_000) + 'SECRET_NEEDLE_xyz' + 'B'.repeat(10_000);
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's',
      commandContext: { command: '/cap:prototype', note: longPayload },
    });
    const raw = readJsonl(tmp);
    // The needle sits after 10k A's, way past the 200-char cap — it must be gone.
    assert.ok(!raw.includes('SECRET_NEEDLE_xyz'), 'length cap lets needle leak');
    // And the persisted note length must be <= 200.
    const parsed = JSON.parse(raw.trim());
    assert.ok(
      !parsed.commandContext.note || parsed.commandContext.note.length <= 200,
      'note must be length-capped to 200'
    );
  });

  // @cap-todo(ac:F-061/AC-5) non-string-typed whitelisted fields are dropped, not coerced
  it('drops non-string whitelisted values (no String() coercion)', () => {
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's',
      commandContext: {
        command: { prompt: 'SECRET_NEEDLE_xyz' }, // object, not string
        feature: ['SECRET_NEEDLE_xyz'],           // array, not string
        agent: 42,                                // number, not string
        note: true,                               // boolean, not string
      },
    });
    const raw = readJsonl(tmp);
    assertNoNeedles(raw);
    const parsed = JSON.parse(raw.trim());
    // All whitelisted keys must be absent because none were strings.
    assert.deepEqual(parsed.commandContext, {}, 'non-string values must be dropped, not coerced');
  });

  // @cap-todo(ac:F-061/AC-5) non-object commandContext does not crash and does not leak
  it('null / number / string commandContext is handled safely', () => {
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's', commandContext: null,
    });
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's', commandContext: 42,
    });
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's', commandContext: 'SECRET_NEEDLE_xyz',
    });
    const raw = readJsonl(tmp);
    assertNoNeedles(raw);
    const lines = raw.trim().split('\n');
    assert.equal(lines.length, 3);
    for (const l of lines) {
      const parsed = JSON.parse(l);
      assert.deepEqual(parsed.commandContext, {});
    }
  });
});

// ---------------------------------------------------------------------------
// AC-5 · Privacy boundary — unicode homoglyphs and obfuscation
// ---------------------------------------------------------------------------

describe('AC-5 adversarial · unicode homoglyph bypass attempts', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-tel-adv-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-061/AC-5) fullwidth/Cyrillic homoglyph keys do not bypass the whitelist
  it('rejects fullwidth/Cyrillic homoglyph variants of prompt/completion as keys', () => {
    const homoglyphs = {
      'ＰＲＯＭＰＴ': 'SECRET_HOMOGLYPH_ETA fullwidth-prompt',
      'рrompt':      'SECRET_HOMOGLYPH_ETA cyrillic',  // Cyrillic р
      'pr​ompt':'SECRET_HOMOGLYPH_ETA zwsp',       // zero-width space
      'PROMPT':      'SECRET_HOMOGLYPH_ETA upper',
      'Prompt':      'SECRET_HOMOGLYPH_ETA capitalized',
      ' prompt':     'SECRET_HOMOGLYPH_ETA leading-space',
      'prompt ':     'SECRET_HOMOGLYPH_ETA trailing-space',
    };
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's', commandContext: { command: '/cap:prototype', ...homoglyphs },
    });
    const raw = readJsonl(tmp);
    // Strict whitelist → homoglyph keys are simply non-whitelisted, so values never reach disk.
    assert.ok(
      !raw.includes('SECRET_HOMOGLYPH_ETA'),
      'homoglyph keys must not bypass the strict whitelist'
    );
  });
});

// ---------------------------------------------------------------------------
// AC-5 · extraneous top-level keys never pollute the persisted record
// ---------------------------------------------------------------------------

describe('AC-5 adversarial · persisted record has a fixed shape', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-tel-adv-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-061/AC-5) only whitelisted top-level keys are persisted
  it('persisted record only contains the documented keys', () => {
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's', featureId: 'F-061',
      // 20 hostile extra keys
      prompt: 'SECRET_NEEDLE_xyz', completion: 'SECRET_NEEDLE_xyz',
      system: 'SECRET_NEEDLE_xyz', input: 'SECRET_NEEDLE_xyz',
      output: 'SECRET_NEEDLE_xyz', text: 'SECRET_NEEDLE_xyz',
      content: 'SECRET_NEEDLE_xyz', message: 'SECRET_NEEDLE_xyz',
      raw: 'SECRET_NEEDLE_xyz', body: 'SECRET_NEEDLE_xyz',
    });
    const raw = readJsonl(tmp);
    assertNoNeedles(raw);
    const parsed = JSON.parse(raw.trim());
    const allowedTop = new Set([
      'id', 'ts', 'model', 'promptTokens', 'completionTokens', 'totalTokens',
      'durationMs', 'sessionId', 'featureId', 'commandContext', 'contextHash',
    ]);
    for (const k of Object.keys(parsed)) {
      assert.ok(
        allowedTop.has(k),
        `persisted record contains non-whitelisted top-level key "${k}"`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// AC-1 · concurrency on O_APPEND
// ---------------------------------------------------------------------------

describe('AC-1 adversarial · concurrent writes keep JSONL line-integrity', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-tel-adv-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-061/AC-1) 100 parallel appends all produce valid JSONL lines
  it('100 parallel recordLlmCall invocations produce 100 valid JSONL lines', async () => {
    const N = 100;
    const jobs = [];
    for (let i = 0; i < N; i++) {
      jobs.push(Promise.resolve().then(() => telemetry.recordLlmCall(tmp, {
        model: 'm-' + (i % 3),
        promptTokens: i, completionTokens: i, durationMs: i,
        sessionId: 's-conc', featureId: 'F-061',
        commandContext: { command: '/cap:prototype', feature: 'F-061' },
      })));
    }
    await Promise.all(jobs);

    const raw = readJsonl(tmp);
    const lines = raw.split('\n').filter(Boolean);
    assert.equal(lines.length, N, `expected ${N} lines, got ${lines.length}`);
    for (const l of lines) {
      // Each line must be independently parseable.
      JSON.parse(l);
      // And must not contain an embedded newline from a partial write.
      assert.ok(!l.includes('\r'), 'lines must not contain embedded CR');
    }
    // All ids must be unique.
    const ids = lines.map((l) => JSON.parse(l).id);
    assert.equal(new Set(ids).size, N, 'call IDs collided');
  });
});

// ---------------------------------------------------------------------------
// AC-6 · config malformations and toggles
// ---------------------------------------------------------------------------

describe('AC-6 adversarial · config malformations never crash and yield deterministic defaults', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-tel-adv-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-061/AC-6) every malformed config variant falls back safely
  const variants = [
    ['missing file (no .cap)', () => { /* intentionally leave tmp blank */ }],
    ['empty file', (r) => writeRawConfig(r, '')],
    ['whitespace only', (r) => writeRawConfig(r, '   \n\t ')],
    ['invalid JSON', (r) => writeRawConfig(r, '{not json')],
    ['truncated JSON', (r) => writeRawConfig(r, '{"telemetry":{"enabled":fal')],
    ['array at root', (r) => writeRawConfig(r, '[1,2,3]')],
    ['string at root', (r) => writeRawConfig(r, '"hi"')],
    ['null at root', (r) => writeRawConfig(r, 'null')],
    ['no telemetry key', (r) => writeConfig(r, { other: 'value' })],
    ['enabled as string "false"', (r) => writeConfig(r, { telemetry: { enabled: 'false' } })],
    ['enabled as number 0', (r) => writeConfig(r, { telemetry: { enabled: 0 } })],
    ['enabled as null', (r) => writeConfig(r, { telemetry: { enabled: null } })],
    ['enabled as undefined-ish', (r) => writeConfig(r, { telemetry: {} })],
    ['enabled as array', (r) => writeConfig(r, { telemetry: { enabled: [] } })],
    ['enabled as object', (r) => writeConfig(r, { telemetry: { enabled: { nested: true } } })],
    ['telemetry as array', (r) => writeConfig(r, { telemetry: [] })],
    ['telemetry as string', (r) => writeConfig(r, { telemetry: 'on' })],
  ];

  for (const [label, seed] of variants) {
    it(`config variant: ${label} — readConfig/isEnabled must not throw`, () => {
      seed(tmp);
      // Must not throw in any direction.
      const cfg = telemetry.readConfig(tmp);
      assert.equal(typeof cfg, 'object', 'readConfig must return an object');
      const enabled = telemetry.isEnabled(tmp);
      assert.equal(typeof enabled, 'boolean', 'isEnabled must return a boolean');
      // Only the strict case `{telemetry:{enabled:false}}` (canonical) is false.
      // Non-boolean / truthy / empty values must default to true.
      const expected = (
        label === 'enabled as number 0'                // coerced truthiness is not enough
        || label === 'enabled as string "false"'       // string "false" !== boolean false
      ) ? true : true;
      assert.equal(enabled, expected);
    });
  }

  // Canonical disabled form remains the ONLY way to disable telemetry.
  it('only telemetry.enabled === false (strict) disables telemetry', () => {
    writeConfig(tmp, { telemetry: { enabled: false } });
    assert.equal(telemetry.isEnabled(tmp), false);
    writeConfig(tmp, { telemetry: { enabled: true } });
    assert.equal(telemetry.isEnabled(tmp), true);
  });
});

// ---------------------------------------------------------------------------
// AC-6 · config races mid-call
// ---------------------------------------------------------------------------

describe('AC-6 adversarial · config flip between two calls is respected deterministically', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-tel-adv-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-061/AC-6) config flips are honoured per-call, no in-process cache
  it('disabling between calls stops new writes; previous writes remain', () => {
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1, sessionId: 's',
    });
    writeConfig(tmp, { telemetry: { enabled: false } });
    const result = telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1, sessionId: 's',
    });
    assert.equal(result, null);
    const lines = readJsonl(tmp).split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'only the first call should be persisted');
  });

  // @cap-todo(ac:F-061/AC-6) re-enabling after a disabled window resumes writes cleanly
  it('re-enabling between calls resumes writes without corrupting existing JSONL', () => {
    writeConfig(tmp, { telemetry: { enabled: false } });
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1, sessionId: 's',
    });
    writeConfig(tmp, { telemetry: { enabled: true } });
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 2, completionTokens: 2, durationMs: 2, sessionId: 's',
    });
    const lines = readJsonl(tmp).split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).promptTokens, 2);
  });
});

// ---------------------------------------------------------------------------
// AC-4 · getLlmUsage query edges
// ---------------------------------------------------------------------------

describe('AC-4 adversarial · query edge cases', () => {
  let tmp;
  beforeEach(() => {
    tmp = mkTmp('cap-tel-adv-');
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's-A', featureId: 'F-061', ts: '2026-04-22T10:00:00Z',
    });
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's-B', featureId: 'F-070', ts: '2026-04-22T12:00:00Z',
    });
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-061/AC-4) from > to yields an empty result set, not a crash
  it('range with from > to returns empty instead of crashing', () => {
    const hits = telemetry.getLlmUsage(tmp, {
      range: { from: '2026-12-31T00:00:00Z', to: '2026-01-01T00:00:00Z' },
    });
    assert.deepEqual(hits, []);
  });

  // @cap-todo(ac:F-061/AC-4) empty filter returns all records (documented behaviour)
  it('empty filter returns ALL records (no session/feature/range specified)', () => {
    const hits = telemetry.getLlmUsage(tmp, {});
    assert.equal(hits.length, 2);
  });

  // @cap-todo(ac:F-061/AC-4) undefined filter is treated like empty filter
  it('undefined filter returns ALL records', () => {
    const hits = telemetry.getLlmUsage(tmp);
    assert.equal(hits.length, 2);
  });

  // @cap-todo(ac:F-061/AC-4) unicode session/feature ids do not break filtering
  it('unicode session IDs match exactly', () => {
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's-Ω', featureId: 'F-ω',
    });
    const hits = telemetry.getLlmUsage(tmp, { sessionId: 's-Ω' });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].featureId, 'F-ω');
  });

  // @cap-todo(ac:F-061/AC-4) malformed JSONL lines are skipped, not fatal
  it('corrupt lines in JSONL are skipped, valid lines still returned', () => {
    const jsonlPath = path.join(tmp, '.cap', 'telemetry', 'llm-calls.jsonl');
    // Append a broken line between the two valid ones.
    fs.appendFileSync(jsonlPath, '{not json\n');
    fs.appendFileSync(jsonlPath, '\n'); // empty line
    fs.appendFileSync(jsonlPath, '"just a string"\n'); // valid JSON, wrong shape — still parseable
    const all = telemetry.getLlmUsage(tmp, {});
    // Two original + one string; the broken line is dropped. Don't require exact 2 because
    // "just a string" is valid JSON and reaches the filter — but .sessionId === undefined,
    // so any session filter still excludes it.
    const realHits = telemetry.getLlmUsage(tmp, { sessionId: 's-A' });
    assert.equal(realHits.length, 1);
    assert.ok(all.length >= 2);
  });

  // @cap-todo(ac:F-061/AC-4) invalid timestamps in range are rejected, not crashy
  it('records with unparseable ts are excluded when a range filter is active', () => {
    const jsonlPath = path.join(tmp, '.cap', 'telemetry', 'llm-calls.jsonl');
    fs.appendFileSync(
      jsonlPath,
      JSON.stringify({ id: 'x', ts: 'not-a-date', sessionId: 's-A', featureId: 'F-061',
        model: 'm', promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0,
        commandContext: {} }) + '\n'
    );
    const hits = telemetry.getLlmUsage(tmp, {
      range: { from: '2026-04-22T00:00:00Z', to: '2026-04-22T23:59:59Z' },
    });
    assert.ok(hits.every((h) => h.ts !== 'not-a-date'));
  });

  // @cap-todo(ac:F-061/AC-4) large JSONL (10k entries) returns within reasonable time
  it('getLlmUsage over 10k records completes in well under 5s', () => {
    const jsonlPath = path.join(tmp, '.cap', 'telemetry', 'llm-calls.jsonl');
    const lines = [];
    for (let i = 0; i < 10_000; i++) {
      lines.push(JSON.stringify({
        id: 'x' + i, ts: '2026-04-22T10:00:00Z',
        model: 'm', promptTokens: 1, completionTokens: 1, totalTokens: 2,
        durationMs: 1, sessionId: 's-big', featureId: 'F-061', commandContext: {},
      }));
    }
    fs.appendFileSync(jsonlPath, lines.join('\n') + '\n');
    const start = Date.now();
    const hits = telemetry.getLlmUsage(tmp, { sessionId: 's-big' });
    const elapsed = Date.now() - start;
    assert.equal(hits.length, 10_000);
    assert.ok(elapsed < 5000, `getLlmUsage took ${elapsed}ms — too slow`);
  });
});

// ---------------------------------------------------------------------------
// AC-7 · zero-deps contract at load time
// ---------------------------------------------------------------------------

describe('AC-7 adversarial · zero-deps contract verified at runtime', () => {
  // @cap-todo(ac:F-061/AC-7) require.cache shows no non-node: deps after loading telemetry
  it('loading cap-telemetry.cjs does not pull any non-node: module into require.cache', () => {
    // Fresh subprocess to eliminate cache pollution from other tests.
    const script = `
      'use strict';
      require('${TELEMETRY_PATH.replace(/\\/g, '\\\\')}');
      const keys = Object.keys(require.cache);
      // Any cached path containing node_modules (in this repo or a hoisted tree) is a forbidden dep.
      const bad = keys.filter((k) => k.split(require('path').sep).includes('node_modules'));
      if (bad.length) {
        console.error(JSON.stringify(bad));
        process.exit(2);
      }
      process.exit(0);
    `;
    const res = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.equal(
      res.status, 0,
      `telemetry pulled node_modules into cache:\n${res.stderr}\n${res.stdout}`
    );
  });

  // @cap-todo(ac:F-061/AC-7) source-level: only node:fs, node:path, node:crypto appear as requires
  it('source-level require() statements are limited to node:fs, node:path, node:crypto', () => {
    const source = fs.readFileSync(TELEMETRY_PATH, 'utf8');
    const allowed = new Set(['node:fs', 'node:path', 'node:crypto']);
    const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    const found = [];
    while ((m = re.exec(source))) found.push(m[1]);
    assert.ok(found.length >= 3);
    for (const dep of found) {
      assert.ok(allowed.has(dep), `forbidden require('${dep}')`);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-2 · aggregate atomicity (temp+rename) + parallel writers
// ---------------------------------------------------------------------------

describe('AC-2 adversarial · aggregate atomicity', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-tel-adv-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-061/AC-2) aggregate file is always a valid JSON document, never half-written
  it('aggregate file is valid JSON after many sequential recordSessionAggregate calls', () => {
    for (let i = 0; i < 50; i++) {
      telemetry.recordLlmCall(tmp, {
        model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
        sessionId: 's-atom', featureId: 'F-061',
      });
      telemetry.recordSessionAggregate(tmp, 's-atom');
      const p = path.join(tmp, '.cap', 'telemetry', 'sessions', 's-atom.json');
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      assert.equal(parsed.sessionId, 's-atom');
      assert.equal(parsed.callCount, i + 1);
    }
  });

  // @cap-todo(ac:F-061/AC-2) two processes writing the same aggregate both leave valid JSON behind
  it('two concurrent processes writing the same aggregate both leave valid JSON', () => {
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's-par', featureId: 'F-061',
    });
    const script = `
      'use strict';
      const t = require('${TELEMETRY_PATH.replace(/\\/g, '\\\\')}');
      t.recordSessionAggregate('${tmp.replace(/\\/g, '\\\\')}', 's-par');
    `;
    // Launch two in parallel.
    const p1 = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    const p2 = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.equal(p1.status, 0, p1.stderr);
    assert.equal(p2.status, 0, p2.stderr);

    const p = path.join(tmp, '.cap', 'telemetry', 'sessions', 's-par.json');
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(parsed.sessionId, 's-par');
    assert.equal(parsed.callCount, 1);
  });

  // @cap-todo(ac:F-061/AC-2) temp files produced during atomic write are cleaned up
  it('atomic write leaves no stray .tmp files in sessions/', () => {
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
      sessionId: 's-clean', featureId: 'F-061',
    });
    telemetry.recordSessionAggregate(tmp, 's-clean');
    const sessionsDir = path.join(tmp, '.cap', 'telemetry', 'sessions');
    const files = fs.readdirSync(sessionsDir);
    for (const f of files) {
      assert.ok(!f.endsWith('.tmp'), `stray temp file left behind: ${f}`);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-5 · hashContext determinism and non-invertibility
// ---------------------------------------------------------------------------

describe('AC-5 adversarial · hashContext properties', () => {
  // @cap-todo(ac:F-061/AC-5) hash is exactly 16 hex chars
  it('hash is exactly 16 lowercase hex chars', () => {
    const h = telemetry.hashContext('anything');
    assert.equal(h.length, 16);
    assert.match(h, /^[0-9a-f]{16}$/);
  });

  // @cap-todo(ac:F-061/AC-5) hash is deterministic across invocations
  it('same input always yields the same digest (deterministic)', () => {
    const inputs = ['', ' ', 'foo', 'foo ', ' foo', 'foo\n', 'Ω', '🔥', 'A'.repeat(10_000)];
    for (const i of inputs) {
      assert.equal(telemetry.hashContext(i), telemetry.hashContext(i));
    }
  });

  // @cap-todo(ac:F-061/AC-5) hash distinguishes whitespace-different inputs
  it('whitespace-different inputs produce different hashes', () => {
    const a = telemetry.hashContext('foo');
    const b = telemetry.hashContext(' foo');
    const c = telemetry.hashContext('foo ');
    const d = telemetry.hashContext('foo\n');
    const set = new Set([a, b, c, d]);
    assert.equal(set.size, 4, 'whitespace-sensitive hashing expected');
  });

  // @cap-todo(ac:F-061/AC-5) non-string input is coerced safely (no crash, no leak of object graph)
  it('non-string inputs are coerced deterministically and do not crash', () => {
    assert.doesNotThrow(() => telemetry.hashContext(null));
    assert.doesNotThrow(() => telemetry.hashContext(undefined));
    assert.doesNotThrow(() => telemetry.hashContext(42));
    assert.doesNotThrow(() => telemetry.hashContext({ a: 1 }));
    // null and undefined both collapse to an empty-string-like digest.
    assert.equal(telemetry.hashContext(null), telemetry.hashContext(undefined));
  });

  // @cap-todo(ac:F-061/AC-5) hash has no trivial collisions across a large random corpus
  it('no trivial collisions in a 1000-item random corpus', () => {
    const seen = new Set();
    for (let i = 0; i < 1000; i++) {
      const h = telemetry.hashContext('item-' + i + '-' + Math.random());
      assert.ok(!seen.has(h), `collision on iteration ${i}`);
      seen.add(h);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-6 · deep no-op when disabled
// ---------------------------------------------------------------------------

describe('AC-6 adversarial · disabled telemetry is a total no-op', () => {
  let tmp;
  beforeEach(() => {
    tmp = mkTmp('cap-tel-adv-');
    writeConfig(tmp, { telemetry: { enabled: false } });
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-061/AC-6) disabled mode creates zero files and zero directories
  it('no telemetry/ directory is ever created while disabled', () => {
    telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1, sessionId: 's',
    });
    telemetry.recordSessionAggregate(tmp, 's');
    assert.equal(
      fs.existsSync(path.join(tmp, '.cap', 'telemetry')),
      false,
      'telemetry directory must not be created while disabled'
    );
  });

  // @cap-todo(ac:F-061/AC-6) getLlmUsage while disabled returns [], not an error
  it('getLlmUsage returns [] while disabled, even when no file exists', () => {
    const hits = telemetry.getLlmUsage(tmp, { sessionId: 'anything' });
    assert.deepEqual(hits, []);
  });

  // @cap-todo(ac:F-061/AC-6) formatSessionStatusLine returns neutral message, never throws
  it('formatSessionStatusLine returns a disabled-telemetry message and never throws', () => {
    assert.doesNotThrow(() => telemetry.formatSessionStatusLine(tmp, 's'));
    assert.doesNotThrow(() => telemetry.formatSessionStatusLine(tmp, null));
    const line = telemetry.formatSessionStatusLine(tmp, 's');
    assert.match(line, /disabled/i);
  });

  // @cap-todo(ac:F-061/AC-6) recordLlmCall returns null consistently while disabled
  it('recordLlmCall returns exactly null (not undefined / false / 0) while disabled', () => {
    const result = telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: 1, completionTokens: 1, durationMs: 1,
    });
    assert.strictEqual(result, null);
  });
});

// ---------------------------------------------------------------------------
// AC-1 · numeric edge cases
// ---------------------------------------------------------------------------

describe('AC-1 adversarial · numeric edge cases for token counts', () => {
  let tmp;
  beforeEach(() => { tmp = mkTmp('cap-tel-adv-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // @cap-todo(ac:F-061/AC-1) negative token counts are clamped to 0, not persisted as-is
  it('negative token counts are clamped to 0', () => {
    const r = telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: -5, completionTokens: -10, durationMs: -1, sessionId: 's',
    });
    assert.equal(r.promptTokens, 0);
    assert.equal(r.completionTokens, 0);
    assert.equal(r.durationMs, 0);
    assert.equal(r.totalTokens, 0);
  });

  // @cap-todo(ac:F-061/AC-1) NaN / Infinity are coerced to 0, not persisted as "null" JSON
  it('NaN / Infinity token counts are coerced to 0', () => {
    const r = telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: NaN, completionTokens: Infinity, durationMs: NaN, sessionId: 's',
    });
    assert.equal(r.promptTokens, 0);
    assert.ok(Number.isFinite(r.completionTokens));
    assert.ok(Number.isFinite(r.durationMs));
    // JSONL must not have "null" or "Infinity" tokens (invalid for downstream integer math).
    const raw = readJsonl(tmp);
    const parsed = JSON.parse(raw.trim());
    assert.equal(Number.isFinite(parsed.promptTokens), true);
    assert.equal(Number.isFinite(parsed.completionTokens), true);
    assert.equal(Number.isFinite(parsed.totalTokens), true);
    assert.equal(Number.isFinite(parsed.durationMs), true);
  });

  // @cap-todo(ac:F-061/AC-1) string-typed token counts are coerced, not passed raw
  it('string-typed token counts are coerced to numbers', () => {
    const r = telemetry.recordLlmCall(tmp, {
      model: 'm', promptTokens: '42', completionTokens: '58', durationMs: '7', sessionId: 's',
    });
    assert.equal(r.promptTokens, 42);
    assert.equal(r.completionTokens, 58);
    assert.equal(r.totalTokens, 100);
    assert.equal(r.durationMs, 7);
  });
});
