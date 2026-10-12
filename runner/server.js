#!/usr/bin/env node
'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const path = require('node:path');
const {
  loadConfig,
  askQuestion,
  followupQuestion,
  pageContextFromPinAskBatch,
} = require('../readonly-advisor/lib');

function usage(exitCode = 0) {
  process.stdout.write(`\nimpl-advisor Runner\n\nUsage:\n  node runner/server.js --config ~/.impl-advisor/planora/project.json [--port 8787] [--host 127.0.0.1] [--dry-run]\n\nEndpoints:\n  GET  /health\n  POST /api/pinask     PinAsk batch -> ask/followup\n  POST /ask            { question, session?, page_context? }\n`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2);
    if (key === 'help' || key === 'dry-run') {
      out[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

function sendJson(res, status, body) {
  const payload = `${JSON.stringify(body, null, 2)}\n`;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`invalid JSON: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

function createHandler({ config, dryRun }) {
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      sendJson(res, 200, {
        ok: true,
        service: 'impl-advisor-runner',
        project: config.project,
        environment: config.environment,
        runtime: config.runtime,
        dryRun,
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/pinask' && url.searchParams.has('status')) {
      sendJson(res, 200, { ok: true, service: 'impl-advisor-runner', project: config.project });
      return;
    }

    try {
      if (req.method === 'POST' && url.pathname === '/ask') {
        const body = await readBody(req);
        const question = body.question;
        const pageContext = body.page_context || null;
        const result = body.session
          ? followupQuestion(body.session, { question, pageContext, dryRun })
          : askQuestion(config, { question, pageContext, dryRun });
        sendJson(res, 200, {
          ok: true,
          id: result.metadata.sessionId,
          session: result.sessionDir,
          answer: result.answer,
          turns: result.metadata.turns,
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/pinask') {
        const batch = await readBody(req);
        const question = batch.question;
        if (!question) {
          sendJson(res, 400, { ok: false, error: 'missing question' });
          return;
        }
        const pageContext = pageContextFromPinAskBatch(batch);
        const session = batch.session || batch.session_dir || batch.advisor_session || null;
        const result = session
          ? followupQuestion(session, { question, pageContext, dryRun })
          : askQuestion(config, { question, pageContext, dryRun });
        sendJson(res, 200, {
          ok: true,
          id: result.metadata.sessionId,
          case_id: result.metadata.sessionId,
          session: result.sessionDir,
          answer: result.answer,
          turns: result.metadata.turns,
          project: config.project,
        });
        return;
      }

      sendJson(res, 404, { ok: false, error: `not found: ${req.method} ${url.pathname}` });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.config) usage(args.help ? 0 : 1);
  const config = loadConfig(args.config);
  const host = args.host || '127.0.0.1';
  const port = Number(args.port || 8787);
  const dryRun = Boolean(args['dry-run']);
  const server = http.createServer(createHandler({ config, dryRun }));
  server.listen(port, host, () => {
    process.stdout.write(`impl-advisor runner listening on http://${host}:${port}\n`);
    process.stdout.write(`config ${path.resolve(args.config)}\n`);
    process.stdout.write(`project ${config.project} runtime=${config.runtime.mode}\n`);
  });
}

if (require.main === module) {
  main();
}

module.exports = { createHandler, parseArgs };
