#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname);
const pinaskRoot = process.env.PINASK_ROOT
  || '/Users/ltc/CursorProject/中交机电局项目/pinask';
const port = Number(process.env.PORT || 8791);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  let filePath;
  if (url.pathname === '/' || url.pathname === '/index.html') {
    filePath = path.join(root, 'pinask-e2e.html');
  } else if (url.pathname.startsWith('/pinask/')) {
    filePath = path.join(pinaskRoot, url.pathname.slice('/pinask/'.length));
  } else {
    send(res, 404, 'not found');
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(res, 404, `missing ${filePath}`);
    return;
  }
  const ext = path.extname(filePath);
  send(res, 200, fs.readFileSync(filePath), types[ext] || 'application/octet-stream');
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`pinask e2e fixture http://127.0.0.1:${port}/\n`);
  process.stdout.write(`pinask root ${pinaskRoot}\n`);
});
