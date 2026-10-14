'use strict';

const assert = require('node:assert/strict');
const {
  shouldSearchRuntime,
  parseRunCandidatesSection,
  classifyCandidates,
  formatRuntimeSearch,
} = require('./runtime-search');

assert.equal(shouldSearchRuntime('语气改写入口在哪', null), false);
assert.equal(shouldSearchRuntime('这次运行日志在哪', null), true);
assert.equal(shouldSearchRuntime('随便问一句', { page_url: 'https://x/test' }), true);

const candidates = parseRunCandidatesSection(`
BEGIN_RUN_CANDIDATES
1710000000.0|120|logs|/opt/planora/logs/a.log
1700000000.0|80|logs|/opt/planora/logs/b.log
END_RUN_CANDIDATES
`);
assert.equal(candidates.length, 2);
assert.equal(candidates[0].root, 'logs');
assert.equal(classifyCandidates(candidates).status, 'multiple');
assert.equal(classifyCandidates(candidates.slice(0, 1)).status, 'single');
assert.equal(classifyCandidates([]).status, 'none');

const text = formatRuntimeSearch({
  status: 'observed',
  roots: ['logs'],
  candidates,
  classification: classifyCandidates(candidates),
});
assert.match(text, /禁止把多次运行拼成一次|不得读取或混合/);
assert.match(text, /a\.log/);

const {
  attachNewestLogSnippet,
} = require('./runtime-search');

const multiplePayload = {
  status: 'observed',
  candidates,
  classification: classifyCandidates(candidates),
};
const skipped = attachNewestLogSnippet(multiplePayload, {
  runtime: { root: '/opt/planora' },
  runSshOpFn: () => { throw new Error('should not read snippet for multiple'); },
});
assert.equal((skipped.snippets || []).length, 0);
assert.match(skipped.snippetSkipped || '', /multiple/);

const singlePayload = {
  status: 'observed',
  candidates: candidates.slice(0, 1),
  classification: classifyCandidates(candidates.slice(0, 1)),
};
const withSnippet = attachNewestLogSnippet(singlePayload, {
  runtime: { root: '/opt/planora' },
  runSshOpFn: () => ({ stdout: 'LOG_LINE_1\n', ms: 1 }),
});
assert.equal(withSnippet.snippets.length, 1);
assert.match(withSnippet.snippets[0].text, /LOG_LINE_1/);

console.log('runtime-search tests passed');
