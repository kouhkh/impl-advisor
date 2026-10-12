'use strict';

const assert = require('node:assert/strict');
const { assertSafeRelPath, parseHealth, deepMergeLimits, DEFAULT_LIMITS } = require('./ssh-readonly');

assert.equal(assertSafeRelPath('current', '/opt/planora').abs, '/opt/planora/current');
assert.equal(assertSafeRelPath('.', '/opt/planora').abs, '/opt/planora');
assert.throws(() => assertSafeRelPath('../etc', '/opt/planora'), /escapes/);
assert.throws(() => assertSafeRelPath('/etc/passwd', '/opt/planora'), /relative/);

const health = parseHealth('hostname=box\nload1=0.20\nnproc=4\nmem_used_mb=1000\nmem_total_mb=7000\ndisk_used=1G/10G(10%)\n');
assert.equal(health.hostname, 'box');
assert.equal(health.load1, 0.2);
assert.equal(health.nproc, 4);

const limits = deepMergeLimits({ maxLoadRatio: 0.5 });
assert.equal(limits.maxLoadRatio, 0.5);
assert.equal(limits.maxConcurrent, DEFAULT_LIMITS.maxConcurrent);

console.log('ssh-readonly unit tests passed');
