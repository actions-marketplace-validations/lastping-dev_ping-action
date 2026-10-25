'use strict';

// Asserts what the local ping server received.
// Usage: node test/check.js <log-file> <expected-json>
// expected-json is an array of {path, rid?, bytes?, body?} in request order.

const fs = require('fs');

const [logFile, expectedJson] = process.argv.slice(2);
const got = fs.existsSync(logFile)
  ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];
const want = JSON.parse(expectedJson);

let ok = got.length === want.length;
for (let i = 0; ok && i < want.length; i++) {
  for (const k of Object.keys(want[i])) {
    if (got[i][k] !== want[i][k]) ok = false;
  }
}

if (!ok) {
  console.error('want: ' + JSON.stringify(want));
  console.error('got:  ' + JSON.stringify(got.map(({ body, ...rest }) => ({ ...rest, body: body.slice(0, 60) }))));
  process.exit(1);
}
console.log('ok: ' + got.length + ' request(s) as expected');
