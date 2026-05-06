'use strict';

// @cap-feature(feature:F-078) Adversarial tests for platform-bucket and extends-resolution.
//   Covers: explicit-only-promotion enforcement (AC-2), cycle-detection with full chain
//   display (AC-5), dangling-extends soft-warn, proto-pollution defense, ANSI/path-traversal
//   defense, empty-block edge case (AC-6).

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const platformLib = require('../cap/bin/lib/cap-memory-platform.cjs');
const extendsLib = require('../cap/bin/lib/cap-memory-extends.cjs');
const schema = require('../cap/bin/lib/cap-memory-schema.cjs');

let SANDBOX;

before(() => {
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-platform-adv-'));
});

after(() => {
  if (SANDBOX) {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  }
});

function makeRoot() {
  return fs.mkdtempSync(path.join(SANDBOX, 'root-'));
}

// -------- AC-2: explicit-only promotion + dual-tag rejection --------

describe('explicit-only-promotion (AC-2)', () => {
  it('@cap-decision with BOTH feature: AND platform: keys → loud parse-error', () => {
    const tag = {
      type: 'decision',
      metadata: { feature: 'F-070', platform: 'observability' },
      file: 'cap/x.cjs',
      line: 42,
    };
    const result = platformLib.classifyDecisionTag(tag);
    assert.equal(result.destination, 'error');
    assert.equal(result.reason, 'both-feature-and-platform');
    // The error MUST mention both refs and the location, so the author can fix it.
    assert.match(result.error, /F-070/);
    assert.match(result.error, /observability/);
    assert.match(result.error, /cap\/x\.cjs:42/);
  });

  it('plain @cap-decision NEVER lands in platform bucket (no auto-promotion)', () => {
    // This is the AC-2 invariant: a decision without an explicit platform: tag must NOT be
    // promoted to the platform bucket regardless of any other signal.
    const tag = {
      type: 'decision',
      metadata: {},
      file: 'cap/x.cjs',
      line: 1,
      description: 'a generic-sounding decision that mentions atomic writes and observability',
    };
    const result = platformLib.classifyDecisionTag(tag);
    assert.notEqual(result.destination, 'platform');
    assert.equal(result.destination, 'unassigned');
  });

  it('invalid platform topic slug → loud error with sanitized echo', () => {
    const tag = {
      type: 'decision',
      metadata: { platform: 'NotKebab' },
      file: 'cap/x.cjs',
      line: 1,
    };
    const result = platformLib.classifyDecisionTag(tag);
    assert.equal(result.destination, 'error');
    assert.equal(result.reason, 'invalid-platform-slug');
    assert.match(result.error, /NotKebab/);
  });

  it('invalid feature id → loud error', () => {
    const tag = {
      type: 'decision',
      metadata: { feature: 'F-7' }, // too few digits
      file: 'cap/x.cjs',
      line: 1,
    };
    const result = platformLib.classifyDecisionTag(tag);
    assert.equal(result.destination, 'error');
    assert.equal(result.reason, 'invalid-feature-id');
  });

  it('classifier is robust to malformed tag input', () => {
    // null tag
    let result = platformLib.classifyDecisionTag(null);
    assert.equal(result.destination, 'error');
    // missing metadata
    result = platformLib.classifyDecisionTag({ type: 'decision' });
    assert.equal(result.destination, 'unassigned');
    // metadata.platform = 'true' (parseMetadata stores keys-without-values as 'true')
    result = platformLib.classifyDecisionTag({ type: 'decision', metadata: { platform: 'true' } });
    assert.equal(result.destination, 'unassigned', 'platform:true (no value) must NOT route to platform');
  });
});

// -------- AC-5: cycle detection with FULL chain display --------

describe('cycle detection (AC-5)', () => {
  it('direct cycle: per-feature → platform/A → platform/A (self-reference)', () => {
    const root = makeRoot();
    // platform/A self-extends.
    const aPath = platformLib.getPlatformTopicPath(root, 'a');
    fs.mkdirSync(path.dirname(aPath), { recursive: true });
    fs.writeFileSync(aPath, [
      '---',
      'topic: a',
      'updated: 2026-05-06T12:00:00Z',
      'extends: platform/a',
      '---',
      '',
      '# Platform: A',
      '',
      '<!-- cap:auto:start -->',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));
    // F-070 extends platform/A.
    const featuresDir = path.join(root, '.cap', 'memory', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    const featureFile = path.join(featuresDir, 'F-070.md');
    fs.writeFileSync(featureFile, [
      '---',
      'feature: F-070',
      'topic: collect',
      'updated: 2026-05-06T12:00:00Z',
      'extends: platform/a',
      '---',
      '',
      '# F-070',
      '',
      '<!-- cap:auto:start -->',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));

    const resolved = extendsLib.resolveExtends(root, featureFile);
    assert.equal(resolved.ok, false);
    assert.ok(resolved.error, 'cycle must produce an error');
    // The full chain MUST appear in the error (not just "cycle detected").
    assert.match(resolved.error, /F-070/);
    assert.match(resolved.error, /platform\/a/);
    assert.match(resolved.error, /→/);
    // cyclePath captures the loop closing on the duplicate ref.
    assert.equal(resolved.cyclePath, 'F-070 → platform/a → platform/a');
  });

  it('indirect cycle: F-070 → platform/A → platform/B → platform/A', () => {
    const root = makeRoot();
    // platform/A extends platform/B.
    const aPath = platformLib.getPlatformTopicPath(root, 'a');
    fs.mkdirSync(path.dirname(aPath), { recursive: true });
    fs.writeFileSync(aPath, [
      '---',
      'topic: a',
      'updated: 2026-05-06T12:00:00Z',
      'extends: platform/b',
      '---',
      '',
      '# Platform: A',
      '',
      '<!-- cap:auto:start -->',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));
    // platform/B extends platform/A (creating the indirect cycle).
    const bPath = platformLib.getPlatformTopicPath(root, 'b');
    fs.writeFileSync(bPath, [
      '---',
      'topic: b',
      'updated: 2026-05-06T12:00:00Z',
      'extends: platform/a',
      '---',
      '',
      '# Platform: B',
      '',
      '<!-- cap:auto:start -->',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));
    // F-070 enters at platform/A.
    const featuresDir = path.join(root, '.cap', 'memory', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    const featureFile = path.join(featuresDir, 'F-070.md');
    fs.writeFileSync(featureFile, [
      '---',
      'feature: F-070',
      'topic: collect',
      'updated: 2026-05-06T12:00:00Z',
      'extends: platform/a',
      '---',
      '',
      '# F-070',
      '',
      '<!-- cap:auto:start -->',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));

    const resolved = extendsLib.resolveExtends(root, featureFile);
    assert.equal(resolved.ok, false);
    assert.equal(resolved.cyclePath, 'F-070 → platform/a → platform/b → platform/a');
    // The error message MUST include the FULL chain (F-082 lesson: don't truncate).
    assert.ok(resolved.error.includes('F-070 → platform/a → platform/b → platform/a'),
      `error message should contain the full chain; got: ${resolved.error}`);
  });
});

// -------- Dangling extends (spec gap → soft-warn) --------

describe('dangling extends (spec-gap soft-warn)', () => {
  it('extends: platform/nonexistent → soft-warn, no crash, layer present but exists=false', () => {
    const root = makeRoot();
    const featuresDir = path.join(root, '.cap', 'memory', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    const featureFile = path.join(featuresDir, 'F-070.md');
    fs.writeFileSync(featureFile, [
      '---',
      'feature: F-070',
      'topic: collect',
      'updated: 2026-05-06T12:00:00Z',
      'extends: platform/nonexistent',
      '---',
      '',
      '# F-070',
      '',
      '<!-- cap:auto:start -->',
      '## Decisions (from tags)',
      '- Local — `f:1`',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));

    const resolved = extendsLib.resolveExtends(root, featureFile);
    assert.equal(resolved.ok, true, 'dangling extends must NOT fail resolution');
    assert.equal(resolved.warnings.length, 1);
    assert.match(resolved.warnings[0], /dangling extends.*platform\/nonexistent/);
    // The dangling layer is recorded with exists=false.
    assert.equal(resolved.layers.length, 2);
    assert.equal(resolved.layers[1].exists, false);

    // Merged view excludes the dangling layer's content (it has no autoBlock).
    const merged = extendsLib.mergeResolvedView(resolved);
    assert.equal(merged.autoBlock.decisions.length, 1);
    assert.equal(merged.autoBlock.decisions[0].text, 'Local');
  });

  it('malformed extends ref (path-traversal attempt) → hard error', () => {
    const root = makeRoot();
    const featuresDir = path.join(root, '.cap', 'memory', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    const featureFile = path.join(featuresDir, 'F-070.md');
    fs.writeFileSync(featureFile, [
      '---',
      'feature: F-070',
      'topic: collect',
      'updated: 2026-05-06T12:00:00Z',
      'extends: ../../etc/passwd',
      '---',
      '',
      '# F-070',
      '',
      '<!-- cap:auto:start -->',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));

    const resolved = extendsLib.resolveExtends(root, featureFile);
    assert.equal(resolved.ok, false);
    assert.match(resolved.error, /invalid extends ref/);
  });
});

// -------- Proto-pollution defense --------

describe('proto-pollution defense', () => {
  it('extends frontmatter with __proto__ key does not pollute parsed object', () => {
    const malicious = [
      '---',
      'feature: F-070',
      'topic: collect',
      'updated: 2026-05-06T12:00:00Z',
      '__proto__: {polluted: true}',
      'extends: platform/observability',
      '---',
      '',
      '# F-070',
      '',
      '<!-- cap:auto:start -->',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n');
    const parsed = schema.parseFeatureMemoryFile(malicious);
    // The parser uses Object.create(null) and a RESERVED_KEYS skip list — so __proto__
    // never reaches the parsed object.
    assert.equal({}.polluted, undefined, 'Object.prototype must not be polluted');
    // The legit `extends` key is still there.
    assert.equal(parsed.frontmatter.extends, 'platform/observability');
    // __proto__ as a literal own-key would be a bug — verify it wasn't set.
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.frontmatter, '__proto__'), false);
  });
});

// -------- ANSI / path-traversal / control-byte defense --------

describe('topic/subsystem slug validation (ANSI + traversal defense)', () => {
  it('topic with .. is rejected', () => {
    assert.throws(
      () => platformLib.getPlatformTopicPath('/tmp/root', '..'),
      /must not contain path separators or traversal sequences|kebab-case/,
    );
  });

  it('topic with / is rejected', () => {
    assert.throws(
      () => platformLib.getPlatformTopicPath('/tmp/root', 'foo/bar'),
      /must not contain path separators or traversal sequences|kebab-case/,
    );
  });

  it('topic with backslash is rejected (Windows-style traversal)', () => {
    assert.throws(
      () => platformLib.getPlatformTopicPath('/tmp/root', 'foo\\bar'),
      /must not contain path separators or traversal sequences|kebab-case/,
    );
  });

  it('topic with ANSI escape bytes is rejected', () => {
    assert.throws(
      () => platformLib.getPlatformTopicPath('/tmp/root', 'foo\x1b[31mbar'),
      /kebab-case|must not contain/,
    );
  });

  it('topic with NUL byte is rejected', () => {
    assert.throws(
      () => platformLib.getPlatformTopicPath('/tmp/root', 'foo\x00bar'),
      /must not contain path separators or traversal sequences|kebab-case/,
    );
  });

  it('subsystem with traversal is rejected', () => {
    assert.throws(
      () => platformLib.getChecklistPath('/tmp/root', '../../escape'),
      /must not contain path separators or traversal sequences|kebab-case/,
    );
  });

  it('classifier rejects ANSI bytes in platform topic value', () => {
    const result = platformLib.classifyDecisionTag({
      type: 'decision',
      metadata: { platform: 'foo\x1b[31m' },
      file: 'x.cjs',
      line: 1,
    });
    assert.equal(result.destination, 'error');
    assert.equal(result.reason, 'invalid-platform-slug');
    // The error should NOT inject the raw escape bytes into the message verbatim.
    assert.equal(result.error.includes('\x1b'), false, 'ANSI bytes must be sanitized in error message');
  });
});

// -------- Empty Auto-block edge case (AC-6) --------

describe('empty auto-block edge case', () => {
  it('renderPlatformTopic with no decisions/pitfalls produces well-formed empty marker pair', () => {
    const out = platformLib.renderPlatformTopic({
      topic: 'empty',
      updated: '2026-05-06T12:00:00Z',
    });
    // Markers MUST appear, on their own lines.
    assert.match(out, /<!-- cap:auto:start -->/);
    assert.match(out, /<!-- cap:auto:end -->/);
    // Re-parse via the F-076 schema parser to confirm it round-trips.
    const parsed = schema.parseFeatureMemoryFile(out);
    assert.deepEqual(parsed.autoBlock.decisions, []);
    assert.deepEqual(parsed.autoBlock.pitfalls, []);
    // Validate via schema validator. Platform files have no `feature:` field — schema
    // validator will report errors on that, but the auto-block markers are still well-formed.
    const validation = schema.validateFeatureMemoryFile(out);
    // Must NOT report duplicate or missing markers.
    const markerErrors = validation.errors.filter((e) => /auto-block/.test(e));
    assert.deepEqual(markerErrors, [], 'auto-block markers must validate even when empty');
  });

  it('byte-identical re-write of empty platform file is a no-op', () => {
    const root = makeRoot();
    const content = platformLib.renderPlatformTopic({
      topic: 'empty',
      updated: '2026-05-06T12:00:00Z',
    });
    const first = platformLib.writePlatformTopic(root, 'empty', content);
    assert.equal(first.updated, true);
    const second = platformLib.writePlatformTopic(root, 'empty', content);
    assert.equal(second.updated, false);
  });
});

// -------- Silent state-update no-op contract (F-082 lesson) --------

describe('silent state-update no-op contract', () => {
  it('writePlatformTopic returns {updated, reason, path} — never void', () => {
    const root = makeRoot();
    const content = platformLib.renderPlatformTopic({ topic: 'noop-test', updated: '2026-05-06T12:00:00Z' });
    const result = platformLib.writePlatformTopic(root, 'noop-test', content);
    assert.equal(typeof result.updated, 'boolean');
    assert.equal(typeof result.reason, 'string');
    assert.equal(typeof result.path, 'string');
  });

  it('writeChecklist returns {updated, reason, path} — never void', () => {
    const root = makeRoot();
    const content = platformLib.renderPlatformTopic({ topic: 'noop-checklist', updated: '2026-05-06T12:00:00Z' });
    const result = platformLib.writeChecklist(root, 'noop-checklist', content);
    assert.equal(typeof result.updated, 'boolean');
    assert.equal(typeof result.reason, 'string');
    assert.equal(typeof result.path, 'string');
  });
});

// -------- listPlatformTopics graceful behavior on missing dir --------

describe('graceful handling of missing platform dir', () => {
  it('listPlatformTopics returns [] when .cap/memory/platform/ is missing', () => {
    const root = makeRoot();
    assert.deepEqual(platformLib.listPlatformTopics(root), []);
  });

  it('listChecklists returns [] when checklists/ is missing', () => {
    const root = makeRoot();
    assert.deepEqual(platformLib.listChecklists(root), []);
  });

  it('writePlatformTopic creates parent dirs as needed (graceful-create)', () => {
    const root = makeRoot();
    // No .cap/memory/platform/ exists yet.
    assert.equal(fs.existsSync(path.join(root, '.cap', 'memory', 'platform')), false);
    const content = platformLib.renderPlatformTopic({ topic: 'fresh', updated: '2026-05-06T12:00:00Z' });
    const result = platformLib.writePlatformTopic(root, 'fresh', content);
    assert.equal(result.updated, true);
    assert.equal(fs.existsSync(path.join(root, '.cap', 'memory', 'platform', 'fresh.md')), true);
  });
});

// -------- F-078/iter1 Stage-2 fixes --------

describe('Stage-2 #1: ANSI defense in extends-resolver', () => {
  it('extends ref containing ANSI escape bytes does NOT leak \\x1b into result.error', () => {
    // The author wrote a malformed `extends:` value carrying ANSI color codes. The schema
    // parser tolerates the bytes (they're plain string in YAML), so the defense has to fire
    // at the resolver layer when it builds the malformed-extends error message.
    const root = makeRoot();
    const featuresDir = path.join(root, '.cap', 'memory', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    const featureFile = path.join(featuresDir, 'F-070.md');
    fs.writeFileSync(featureFile, [
      '---',
      'feature: F-070',
      'topic: collect',
      'updated: 2026-05-06T12:00:00Z',
      'extends: \x1b[31mevil\x1b[0m',
      '---',
      '',
      '# F-070',
      '',
      '<!-- cap:auto:start -->',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));

    const resolved = extendsLib.resolveExtends(root, featureFile);
    assert.equal(resolved.ok, false);
    assert.match(resolved.error, /invalid extends ref/);
    // CRITICAL ASSERT: no raw ANSI escape bytes in the error string. This is the F-078/iter1
    // pin — without _safeForError on extendsRef, this assertion fails.
    assert.equal(resolved.error.includes('\x1b'), false,
      `error must not leak ANSI bytes; got: ${JSON.stringify(resolved.error)}`);
  });

  it('dangling-extends warning sanitizes user-controlled ref bytes', () => {
    // A well-formed `platform/<topic>` ref with a topic that — by way of regex — can't carry
    // ANSI bytes. To probe the warning path's sanitizer, we'd need a bypass; the regex
    // already prevents that. Instead, verify the warning IS produced and the path is clean.
    // This is a forward-compat pin: if someone loosens parseExtendsRef's regex in the future,
    // the sanitizer in the warning string keeps the defense.
    const root = makeRoot();
    const featuresDir = path.join(root, '.cap', 'memory', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    const featureFile = path.join(featuresDir, 'F-070.md');
    fs.writeFileSync(featureFile, [
      '---',
      'feature: F-070',
      'topic: collect',
      'updated: 2026-05-06T12:00:00Z',
      'extends: platform/nonexistent',
      '---',
      '',
      '# F-070',
      '',
      '<!-- cap:auto:start -->',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));

    const resolved = extendsLib.resolveExtends(root, featureFile);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.warnings.length, 1);
    // Forward-compat ANSI assertion: even if a future bug allowed bytes through, the
    // sanitizer would catch them here.
    assert.equal(resolved.warnings[0].includes('\x1b'), false);
  });
});

describe('Stage-2 #2: deep-clone frontmatter on mergeResolvedView (F-082 lesson)', () => {
  it('mutating merged.frontmatter.related_features does NOT poison source file', () => {
    const root = makeRoot();
    const featuresDir = path.join(root, '.cap', 'memory', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    const featureFile = path.join(featuresDir, 'F-070.md');
    // YAML inline-array `[F-001, F-002]` — schema parser keeps these as arrays under the
    // `related_features` key. (If parser stores it as raw string, the test still proves
    // the SCALAR isn't shared across calls; only array case probes the F-082 lesson directly.)
    fs.writeFileSync(featureFile, [
      '---',
      'feature: F-070',
      'topic: collect',
      'updated: 2026-05-06T12:00:00Z',
      'related_features: [F-001, F-002]',
      '---',
      '',
      '# F-070',
      '',
      '<!-- cap:auto:start -->',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));

    const resolved = extendsLib.resolveExtends(root, featureFile);
    assert.equal(resolved.ok, true);
    const merged = extendsLib.mergeResolvedView(resolved);

    // Snapshot the original by re-resolving fresh BEFORE we mutate.
    const beforeMutation = extendsLib.resolveExtends(root, featureFile);
    const beforeFrontmatter = beforeMutation.layers[0].file.frontmatter;
    const beforeSnapshot = JSON.stringify(beforeFrontmatter);

    // Mutate the merged frontmatter aggressively. Add a new key, mutate any array values.
    merged.frontmatter.injected = 'F-CORRUPTED';
    if (Array.isArray(merged.frontmatter.related_features)) {
      merged.frontmatter.related_features.push('F-CORRUPTED');
    }

    // Re-resolve from disk and confirm the source is untouched.
    const after = extendsLib.resolveExtends(root, featureFile);
    const afterFrontmatter = after.layers[0].file.frontmatter;
    assert.equal(JSON.stringify(afterFrontmatter), beforeSnapshot,
      'source frontmatter must be byte-identical after mutating merged view');
    // Also assert in-memory cross-resolve isolation — the resolved layer from BEFORE should
    // not have been poisoned either.
    assert.equal(beforeFrontmatter.injected, undefined,
      'mutation through merged.frontmatter must not bleed into resolved.layers[0].file.frontmatter');
    if (Array.isArray(beforeFrontmatter.related_features)) {
      assert.equal(beforeFrontmatter.related_features.includes('F-CORRUPTED'), false,
        'array values in merged.frontmatter must be deep-cloned, not aliased');
    }
  });
});

describe('Stage-2 #3: malformed-extends mid-chain message has no double prefix', () => {
  it('mid-chain malformed-extends names parent ref EXACTLY once', () => {
    // F-070 → platform/a (which has a malformed extends: not-platform/foo).
    // The error must mention `platform/a` ONCE, not `platform/platform/a`.
    const root = makeRoot();
    // Write the malformed platform/a file. Its frontmatter is shape-valid for the schema
    // (extends matches EXTENDS_RE in F-076 only if it begins with `platform/`), but the
    // resolver's parseExtendsRef is strict: a non-`platform/` ref triggers the malformed
    // path. Use a value the schema parser tolerates as a string but parseExtendsRef rejects.
    const aPath = platformLib.getPlatformTopicPath(root, 'a');
    fs.mkdirSync(path.dirname(aPath), { recursive: true });
    fs.writeFileSync(aPath, [
      '---',
      'topic: a',
      'updated: 2026-05-06T12:00:00Z',
      'extends: not-platform/foo',
      '---',
      '',
      '# Platform: A',
      '',
      '<!-- cap:auto:start -->',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));

    const featuresDir = path.join(root, '.cap', 'memory', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    const featureFile = path.join(featuresDir, 'F-070.md');
    fs.writeFileSync(featureFile, [
      '---',
      'feature: F-070',
      'topic: collect',
      'updated: 2026-05-06T12:00:00Z',
      'extends: platform/a',
      '---',
      '',
      '# F-070',
      '',
      '<!-- cap:auto:start -->',
      '<!-- cap:auto:end -->',
      '',
    ].join('\n'));

    const resolved = extendsLib.resolveExtends(root, featureFile);
    assert.equal(resolved.ok, false);
    assert.match(resolved.error, /invalid extends ref/);
    // Pin assertion: `platform/a` appears EXACTLY once in the error message.
    const matches = resolved.error.match(/platform\/a/g) || [];
    assert.equal(matches.length, 1,
      `'platform/a' must appear exactly once (no double-prefix); got: ${resolved.error}`);
    // Negative assertion: the broken `platform/platform/a` substring must NOT appear.
    assert.equal(resolved.error.includes('platform/platform/'), false,
      `double-prefix bug must be fixed; got: ${resolved.error}`);
    // Sanity: the malformed ref is the one being rejected.
    assert.match(resolved.error, /not-platform\/foo/);
  });
});
