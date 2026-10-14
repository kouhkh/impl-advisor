'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { analyzeQuestionThemes, formatSplitPlan } = require('./question-split');

const q123 = fs.readFileSync(
  path.join(os.homedir(), '.impl-advisor/planora/ablation/user-q123-20261012T093000Z/question.md'),
  'utf8',
);

const analysis = analyzeQuestionThemes(q123);
assert.equal(analysis.multiTheme, true);
assert.equal(analysis.parts.length, 3);
assert.ok(analysis.parts[0].topics.includes('outline-source') || /投标施组/.test(analysis.parts[0].text));
assert.ok(analysis.parts[1].topics.includes('parse-limit') || /DOCUMENT_RESOURCE_LIMIT/.test(analysis.parts[1].text));
assert.ok(analysis.parts[2].topics.includes('rewrite-ying') || /适应带宽/.test(analysis.parts[2].text));
assert.match(formatSplitPlan(analysis), /将拆成 3 个独立会话/);

const single = analyzeQuestionThemes('maxMediaDocumentPages 默认是多少？请给出代码路径。');
assert.equal(single.multiTheme, false);
assert.equal(single.parts.length, 1);

const sameThemeNumbered = analyzeQuestionThemes(`回答两个问题：
1. maxMediaDocumentPages 在哪个文件？
2. 该上限能否用环境变量覆盖？
`);
assert.equal(sameThemeNumbered.multiTheme, true);
assert.equal(sameThemeNumbered.parts.length, 2);

console.log('question-split-test: ok');
console.log(formatSplitPlan(analysis));
