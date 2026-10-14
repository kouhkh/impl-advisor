'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const {
  FIXTURE_SCHEMA,
  normalizeStructuredRuntime,
  listRecords,
  getRecord,
  formatStructuredRuntime,
} = require('./structured-runtime');
const { runRecordList, runRecordGet, GATEWAY_OPS } = require('./evidence-gateway');
const {
  createWorkingMemory,
  decideAllowedOps,
} = require('./working-memory');

assert.ok(GATEWAY_OPS.includes('run.record_list'));
assert.ok(GATEWAY_OPS.includes('run.record_get'));

const fixturePath = path.join(__dirname, '..', 'fixtures', 'structured-runtime', 'manifest.json');

assert.equal(normalizeStructuredRuntime(null).mode, 'none');
assert.throws(
  () => normalizeStructuredRuntime({ mode: 'fixture' }),
  /fixturePath/,
);

const structured = normalizeStructuredRuntime({
  mode: 'fixture',
  fixturePath,
  collections: {
    catalog_items: { description: 'demo catalog' },
  },
  notes: 'neutral protocol fixture',
});
assert.equal(structured.enabled, true);
assert.equal(structured.mode, 'fixture');

const listed = listRecords(structured, {
  collection: 'catalog_items',
  query: 'FOO-100',
});
assert.equal(listed.status, 'observed');
assert.equal(listed.returned, 1);
assert.equal(listed.records[0].id, 'item-alpha-001');
assert.equal(listed.records[0].body, undefined, 'listFields should hide body text');

const got = getRecord(structured, {
  collection: 'catalog_items',
  id: 'item-alpha-001',
});
assert.equal(got.status, 'observed');
assert.match(got.record.body, /foo maps to bar/);
assert.equal(got.record.sku, 'FOO-100');

const missing = getRecord(structured, { collection: 'catalog_items', id: 'nope' });
assert.equal(missing.status, 'missing_record');

const sql = normalizeStructuredRuntime({
  mode: 'sql',
  connectionEnv: 'ADVISOR_READONLY_DATABASE_URL',
  allowQueries: { demo: { sql: 'select 1' } },
});
const sqlList = listRecords(sql, { collection: 'demo' });
assert.equal(sqlList.status, 'not_implemented');

const cardList = runRecordList({ structuredRuntime: structured }, {
  collection: 'catalog_items',
  where: { sku: 'FOO-100' },
});
assert.equal(cardList.op, 'run.record_list');
assert.ok(cardList.pointers.includes('catalog_items/item-alpha-001'));

const cardGet = runRecordGet({ structuredRuntime: structured }, {
  collection: 'catalog_items',
  id: 'item-alpha-001',
});
assert.equal(cardGet.op, 'run.record_get');
assert.match(cardGet.payload.record.body, /foo maps to bar/);

const help = formatStructuredRuntime(structured);
assert.match(help, /run\.record_list/);
assert.match(help, /项目只读数据/);

const memory = createWorkingMemory({ sessionId: 't', structuredRuntime: true });
assert.ok(decideAllowedOps(memory).includes('run.record_list'));
assert.ok(decideAllowedOps(memory).includes('run.record_get'));
// 多文件候选未确认时，结构化记录仍可用
memory.runCandidate = { status: 'multiple', selected: null, roots: [], candidateCount: 2, detail: 'x' };
const ops = decideAllowedOps(memory);
assert.ok(ops.includes('run.record_list'));
assert.ok(!ops.includes('run.log_slice'));

assert.equal(FIXTURE_SCHEMA, 'readonly-advisor-structured-runtime-fixture/1');
console.log('structured-runtime-test: ok');
