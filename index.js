'use strict';

// LastPing ping action: reports a job's start and outcome to a LastPing
// monitor's ping URL. Plain Node, no dependencies, so it behaves the same on
// Linux, macOS and Windows runners whether or not curl is installed.

const http = require('http');
const https = require('https');

const BODY_LIMIT = 10000; // bytes; LastPing stores up to 10,000 bytes of a POSTed body
const ATTEMPTS = 3;
const TIMEOUT_MS = 10000;

function input(name) {
  const key = 'INPUT_' + name.replace(/ /g, '_').toUpperCase();
  return (process.env[key] || '').trim();
}

// Workflow commands are written to stdout. Values are escaped the way the
// runner expects, so a message can never be read as a second command.
function escapeData(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function command(name, message) {
  process.stdout.write('::' + name + '::' + escapeData(message) + '\n');
}

// Maps a status to the ping URL suffix. null means "send nothing".
// success -> <url>, start -> <url>/start, failure -> <url>/fail,
// log -> <url>/log, an exit code -> <url>/<code>.
function suffixFor(status, onCancelled) {
  const s = status.toLowerCase();
  switch (s) {
    case 'start':
      return '/start';
    case 'success':
    case 'ok':
      return '';
    case 'failure':
    case 'fail':
    case 'failed':
      return '/fail';
    case 'log':
      return '/log';
    case 'cancelled':
    case 'canceled':
      if (onCancelled === 'skip') return null;
      if (onCancelled === 'log') return '/log';
      return '/fail';
    case 'skipped':
      return null;
    default:
      if (/^[0-9]{1,3}$/.test(s) && Number(s) <= 255) return '/' + Number(s);
      throw new Error(
        'unknown status "' + status + '": use start, success, failure, cancelled, log or an exit code 0-255'
      );
  }
}

function defaultBody(status) {
  const s = status.toLowerCase();
  if (s === 'cancelled' || s === 'canceled') return 'GitHub Actions job cancelled';
  return '';
}

// Cuts a string to at most `limit` UTF-8 bytes without splitting a character.
function truncateUtf8(s, limit) {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= limit) return buf;
  let end = limit;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end);
}

function buildUrl(base, suffix, runId) {
  const u = new URL(base);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('ping-url must be an http or https URL');
  }
  u.pathname = u.pathname.replace(/\/+$/, '') + suffix;
  if (runId) u.searchParams.set('rid', runId);
  return u;
}

function send(url, body) {
  return new Promise((resolve) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': body.length,
          'User-Agent': 'lastping-ping-action/1',
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode }));
        res.on('error', (err) => resolve({ error: err.message }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('timed out after ' + TIMEOUT_MS / 1000 + 's')));
    req.on('error', (err) => resolve({ error: err.message }));
    req.end(body);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Never include the URL in a message: it is a secret.
async function ping(url, body) {
  let last = '';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const res = await send(url, body);
    if (res.status >= 200 && res.status < 300) return { ok: true, attempt };
    if (res.status) {
      last = 'HTTP ' + res.status;
      // 4xx other than 408/429 will not get better on a retry.
      if (res.status < 500 && res.status !== 408 && res.status !== 429) break;
    } else {
      last = res.error || 'request failed';
    }
    if (attempt < ATTEMPTS) await sleep(attempt * 1000);
  }
  return { ok: false, reason: last };
}

async function main() {
  const rawUrl = input('ping-url');
  if (rawUrl) {
    command('add-mask', rawUrl);
    // Also mask the monitor id alone, in case any later step prints a path.
    try {
      const id = new URL(rawUrl).pathname.replace(/^\/+|\/+$/g, '');
      if (id.length >= 8) command('add-mask', id);
    } catch (_) {
      // Invalid URL; reported below.
    }
  }

  const failOnError = input('fail-on-error').toLowerCase() === 'true';
  const fail = (msg) => {
    if (failOnError) {
      command('error', msg);
      process.exitCode = 1;
    } else {
      command('warning', msg);
    }
  };

  if (!rawUrl) {
    fail('LastPing: ping-url is empty, so no ping was sent. Is the secret set for this repository?');
    return;
  }

  const status = input('status') || 'success';
  const onCancelled = (input('on-cancelled') || 'fail').toLowerCase();
  if (!['fail', 'log', 'skip'].includes(onCancelled)) {
    fail('LastPing: on-cancelled must be fail, log or skip.');
    return;
  }

  let suffix;
  let url;
  try {
    suffix = suffixFor(status, onCancelled);
    if (suffix === null) {
      console.log('LastPing: status "' + status + '", no ping sent.');
      return;
    }
    url = buildUrl(rawUrl, suffix, input('run-id'));
  } catch (err) {
    // URL parse errors can echo the input, so report a fixed message for those.
    const msg = err instanceof TypeError ? 'ping-url is not a valid URL' : err.message;
    fail('LastPing: ' + msg + '.');
    return;
  }

  const body = truncateUtf8(input('body') || defaultBody(status), BODY_LIMIT);
  const kind = suffix === '' ? 'success' : /^\/[0-9]+$/.test(suffix) ? 'exit code ' + suffix.slice(1) : suffix.slice(1);
  const res = await ping(url, body);
  if (res.ok) {
    console.log('LastPing: sent ' + kind + ' ping' + (res.attempt > 1 ? ' (attempt ' + res.attempt + ')' : '') + '.');
  } else {
    fail('LastPing: ' + kind + ' ping failed after retries (' + res.reason + ').');
  }
}

main().catch((err) => {
  // Last-resort guard; the message never carries the URL.
  const msg = 'LastPing: unexpected error (' + (err && err.name ? err.name : 'Error') + ').';
  if (input('fail-on-error').toLowerCase() === 'true') {
    command('error', msg);
    process.exitCode = 1;
  } else {
    command('warning', msg);
  }
});
