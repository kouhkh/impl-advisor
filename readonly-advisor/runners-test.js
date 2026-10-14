'use strict';

const assert = require('node:assert/strict');
const { resolveRunnerKind, runHarness, describeRunner } = require('./runners');

assert.equal(resolveRunnerKind({}), 'dsh');
assert.equal(resolveRunnerKind({ runner: 'OpenCode' }), 'opencode');

const dryDsh = runHarness({
  runner: 'dsh',
  dryRun: true,
  workspace: process.cwd(),
  dshBin: 'dsh',
  dshHome: '/tmp',
}, 'hello-wm');
assert.match(dryDsh, /\[dry-run\]/);
assert.match(dryDsh, /hello-wm/);

const dryOc = runHarness({
  runner: 'opencode',
  dryRun: true,
  workspace: process.cwd(),
}, 'same-brief');
assert.match(dryOc, /\[dry-run:opencode\]/);
assert.match(dryOc, /same-brief/);

const dryCursor = runHarness({
  runner: 'cursor',
  dryRun: true,
  workspace: process.cwd(),
}, 'cursor-brief');
assert.match(dryCursor, /\[dry-run:cursor\]/);

const desc = describeRunner({ runner: 'opencode', opencodeBin: '/usr/local/bin/opencode' });
assert.equal(desc.kind, 'opencode');
assert.equal(desc.bin, '/usr/local/bin/opencode');

let threw = false;
try {
  runHarness({ runner: 'unknown-x', dryRun: true, workspace: process.cwd() }, 'x');
} catch (error) {
  threw = /unsupported runner/.test(error.message);
}
assert.ok(threw);

console.log('runners-test: ok');
