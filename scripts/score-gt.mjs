#!/usr/bin/env node
import fs from 'node:fs';
const src = process.argv[2];
const dest = process.argv[3] || src.replace(/answer\.md$/, 'score.json');
const text = fs.readFileSync(src, 'utf8');
const checks = {
  q3_artifact: /确保适带宽/i.test(text),
  q3_ensure_ying: /ying-tail|YING_FALSE_COMPOUND|假合词|ensure/i.test(text),
  q3_unfixed: /未修复|仍可复现|不能确认已修复|无法确认.*修复|unknown.*fix|当前无法确认/i.test(text)
    && !/当前代码.*已修复|bb57ee33.*已修复/i.test(text),
  q3_wrong_fixed: /已修复/.test(text) && !/未修复|仍可复现|不能确认已修复|无法确认|当前无法确认/i.test(text),
};
const hit = Object.entries(checks).filter(([, v]) => v).map(([k]) => k);
const rec = { file: src, chars: text.length, checks, hit, hitCount: hit.length };
fs.writeFileSync(dest, `${JSON.stringify(rec, null, 2)}\n`);
console.log(JSON.stringify(rec, null, 2));
