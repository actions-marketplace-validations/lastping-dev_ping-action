'use strict';

// A local stand-in for the ping host, used by the self-test workflow.
// Usage: node test/server.js <port> <log-file>
// Writes one JSON line per request: method, path, rid, body length, body.
// A request whose rid is "retry-once" gets a 503 the first time.

const fs = require('fs');
const http = require('http');

const port = Number(process.argv[2] || 18080);
const logFile = process.argv[3] || 'requests.jsonl';
let retried = false;

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://localhost');
      const body = Buffer.concat(chunks);
      const rid = u.searchParams.get('rid') || '';
      if (rid === 'retry-once' && !retried) {
        retried = true;
        res.writeHead(503);
        res.end('try again');
        return;
      }
      fs.appendFileSync(
        logFile,
        JSON.stringify({
          method: req.method,
          path: u.pathname,
          rid,
          bytes: body.length,
          body: body.toString('utf8'),
        }) + '\n'
      );
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    });
  })
  .listen(port, '127.0.0.1', () => {
    console.log('listening on ' + port);
  });
