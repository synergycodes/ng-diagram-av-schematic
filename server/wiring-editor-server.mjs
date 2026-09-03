#!/usr/bin/env node
// Minimal local service for the talus-wiring-editor tracer bullet (issue #1).
//
// Serves the Angular production build and a same-origin JSON API for
// saving/reopening projects in a configurable central storage directory —
// no framework, no new npm dependency, Node core modules only.
//
// This repository does not install or start the service automatically.
// On Talus, deployment is managed by the talus-core operational wrapper.
// To run it manually once a production build exists:
//
//   node server/wiring-editor-server.mjs
//
// Config (env vars, all optional):
//   WIRING_EDITOR_HOST           listener host (default: 127.0.0.1 — loopback only)
//   WIRING_EDITOR_PORT           listener port (default: 4173)
//   WIRING_EDITOR_STATIC_DIR     Angular build output to serve
//                                (default: dist/ng-diagram-av-schematic/browser)
//   WIRING_EDITOR_STORAGE_DIR    central project storage directory
//                                (default: ~/.local/share/talus-wiring-editor/projects)
//   WIRING_EDITOR_ALLOWED_HOSTS  comma-separated extra `host:port` values accepted
//                                in the request Host header (e.g. a Tailscale
//                                MagicDNS name), on top of the loopback defaults
//
// See docs/local-service.md for the full contract, the loopback + Tailscale
// Serve deployment plan, and what's intentionally out of scope here.

import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanonicalProjectValidationError, parseCanonicalProject } from './canonical-project-validate.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const DEFAULT_PORT = Number(process.env['WIRING_EDITOR_PORT']) || 4173;

/**
 * Host header allowlist — the primary DNS-rebinding defense: a page served
 * from an attacker-controlled domain that resolves to 127.0.0.1 still sends
 * that domain as the Host header, which won't match this set, so the
 * request is rejected before it ever reaches the API or filesystem.
 * `WIRING_EDITOR_ALLOWED_HOSTS` adds entries (e.g. a Tailscale MagicDNS name)
 * on top of the loopback defaults — it never replaces them.
 */
function buildAllowedHosts(port, extraCsv) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  for (const entry of (extraCsv ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed) hosts.add(trimmed);
  }
  return hosts;
}

export const config = {
  host: process.env['WIRING_EDITOR_HOST'] || '127.0.0.1',
  port: DEFAULT_PORT,
  // Resolved unconditionally: a relative WIRING_EDITOR_STATIC_DIR would
  // otherwise compare as relative against the always-absolute containment
  // check in serveStatic and reject every request.
  staticDir: resolve(
    process.env['WIRING_EDITOR_STATIC_DIR'] || join(REPO_ROOT, 'dist', 'ng-diagram-av-schematic', 'browser'),
  ),
  storageDir: resolve(
    process.env['WIRING_EDITOR_STORAGE_DIR'] ||
      join(homedir(), '.local', 'share', 'talus-wiring-editor', 'projects'),
  ),
  allowedHosts: buildAllowedHosts(DEFAULT_PORT, process.env['WIRING_EDITOR_ALLOWED_HOSTS']),
};

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB — generous for a hand-edited circuit project.
const MUTATING_METHODS = new Set(['PUT', 'POST', 'PATCH', 'DELETE']);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** An error carrying the HTTP status/body it should produce, so the central catch never has to guess. */
export class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message ?? code);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Builds the (unstarted) http.Server, so it can be created/tested without listening. */
export function createWiringEditorServer(cfg = config) {
  return createServer((req, res) => {
    handleRequest(req, res, cfg).catch((err) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) {
        sendJson(res, err.statusCode, { error: err.code, message: err.message });
        return;
      }
      console.error('[wiring-editor-server] unhandled error:', err);
      sendJson(res, 500, { error: 'internal_error' });
    });
  });
}

async function handleRequest(req, res, cfg) {
  const hostHeader = req.headers.host;
  if (typeof hostHeader !== 'string' || !cfg.allowedHosts.has(hostHeader)) {
    throw new HttpError(400, 'invalid_host', `cabeçalho Host não reconhecido: ${hostHeader ?? '(ausente)'}`);
  }

  if (MUTATING_METHODS.has(req.method ?? '')) {
    rejectCrossOriginMutation(req, hostHeader);
  }

  let url;
  try {
    url = new URL(req.url ?? '/', `http://${hostHeader}`);
  } catch {
    throw new HttpError(400, 'invalid_request_target', 'URI malformada');
  }

  const segments = url.pathname.split('/').filter(Boolean);

  if (segments[0] === 'api' && segments[1] === 'projects') {
    await handleProjectsApi(req, res, segments, cfg);
    return;
  }

  await serveStatic(req, res, url, cfg);
}

/**
 * CSRF / cross-origin mitigation for state-changing requests. Both checks
 * are opt-in from the client's perspective: they only fire when the browser
 * (or a malicious page) actually sent the header, so a plain `curl -X PUT`
 * with no Origin/Sec-Fetch-Site header — the documented local workflow —
 * always passes. `Sec-Fetch-Site` is what modern browsers attach on every
 * request; `Origin` is the fallback for older/simpler clients that send it.
 */
function rejectCrossOriginMutation(req, hostHeader) {
  const secFetchSite = req.headers['sec-fetch-site'];
  if (typeof secFetchSite === 'string' && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    throw new HttpError(
      403,
      'cross_site_forbidden',
      `Sec-Fetch-Site "${secFetchSite}" não é permitido para esta requisição`,
    );
  }

  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new HttpError(400, 'invalid_origin', 'cabeçalho Origin inválido');
    }
    if (originHost !== hostHeader) {
      throw new HttpError(
        403,
        'cross_origin_forbidden',
        `Origin "${origin}" não corresponde a este host`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Projects API — /api/projects, /api/projects/:id
// ---------------------------------------------------------------------------

async function handleProjectsApi(req, res, segments, cfg) {
  // segments === ['api', 'projects', ...]; anything past index 2 is not a route this API has.
  if (segments.length > 3) {
    return sendJson(res, 404, { error: 'not_found' });
  }

  const id = segments[2];

  if (id === undefined) {
    if (req.method === 'GET') return void (await listProjects(res, cfg));
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  if (!PROJECT_ID_PATTERN.test(id)) {
    return sendJson(res, 400, { error: 'invalid_project_id' });
  }

  if (req.method === 'GET') return void (await getProject(res, cfg, id));
  if (req.method === 'PUT') return void (await putProject(req, res, cfg, id));
  if (req.method === 'DELETE') return void (await deleteProject(res, cfg, id));
  return sendJson(res, 405, { error: 'method_not_allowed' });
}

async function listProjects(res, cfg) {
  await mkdir(cfg.storageDir, { recursive: true });
  const entries = await readdir(cfg.storageDir, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const id = entry.name.slice(0, -'.json'.length);
    if (!PROJECT_ID_PATTERN.test(id)) continue; // ignore anything that isn't ours

    const filePath = join(cfg.storageDir, entry.name);
    try {
      const [raw, stats] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)]);
      const parsed = JSON.parse(raw);
      projects.push({
        id,
        name: typeof parsed.name === 'string' ? parsed.name : id,
        updatedAt: stats.mtime.toISOString(),
      });
    } catch (err) {
      console.warn(`[wiring-editor-server] skipping unreadable project "${id}":`, err.message);
    }
  }

  sendJson(res, 200, { projects });
}

async function getProject(res, cfg, id) {
  const filePath = projectFilePath(cfg, id);
  try {
    const raw = await readFile(filePath, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return sendJson(res, 404, { error: 'not_found' });
    throw err;
  }
}

async function putProject(req, res, cfg, id) {
  requireJsonContentType(req);
  const body = await readJsonBody(req);
  if (body === null) {
    throw new HttpError(400, 'invalid_body', 'corpo vazio: esperado um objeto JSON');
  }

  let project;
  try {
    project = parseCanonicalProject(body);
  } catch (err) {
    if (err instanceof CanonicalProjectValidationError) {
      throw new HttpError(400, 'invalid_project', err.message);
    }
    throw err;
  }

  await mkdir(cfg.storageDir, { recursive: true });
  const filePath = projectFilePath(cfg, id);
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;

  try {
    // Atomic write: write to a scratch file, then rename over the target —
    // readers never observe a partially-written project file.
    await writeFile(tmpPath, JSON.stringify(project, null, 2), 'utf8');
    await rename(tmpPath, filePath);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }

  sendJson(res, 200, { id, saved: true });
}

async function deleteProject(res, cfg, id) {
  const filePath = projectFilePath(cfg, id);
  try {
    await rm(filePath);
    sendJson(res, 200, { id, deleted: true });
  } catch (err) {
    if (err.code === 'ENOENT') return sendJson(res, 404, { error: 'not_found' });
    throw err;
  }
}

function projectFilePath(cfg, id) {
  // `id` is already validated against PROJECT_ID_PATTERN (no path separators,
  // no leading dot), so this can't escape storageDir.
  return join(cfg.storageDir, `${id}.json`);
}

function requireJsonContentType(req) {
  const contentType = req.headers['content-type'];
  const mimeType = typeof contentType === 'string' ? contentType.split(';')[0].trim().toLowerCase() : '';
  if (mimeType !== 'application/json') {
    throw new HttpError(415, 'unsupported_media_type', 'Content-Type deve ser application/json');
  }
}

async function readJsonBody(req) {
  const raw = await new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
    };

    const onData = (chunk) => {
      // After rejecting an oversized body, keep this listener attached so
      // Node drains and discards the remaining bytes without buffering them.
      // Destroying IncomingMessage here would also destroy the response
      // socket before the central handler can send HTTP 413.
      if (settled) return;

      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        chunks.length = 0;
        rejectBody(new HttpError(413, 'payload_too_large', 'corpo da requisição excede o limite de 5 MB'));
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      cleanup();
      if (settled) return;
      settled = true;
      resolveBody(Buffer.concat(chunks).toString('utf8'));
    };

    const rejectRead = () => {
      cleanup();
      if (settled) return;
      settled = true;
      rejectBody(new HttpError(400, 'invalid_body', 'falha ao ler o corpo da requisição'));
    };

    const onError = () => rejectRead();
    const onAborted = () => rejectRead();

    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onAborted);
  });

  if (raw.trim() === '') return null;

  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid_json', 'JSON malformado no corpo da requisição');
  }
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

// ---------------------------------------------------------------------------
// Static file serving — the Angular production build. No dev server, no
// build step here: `ng build` must have already produced `staticDir`.
// ---------------------------------------------------------------------------

async function serveStatic(req, res, url, cfg) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'invalid_path', 'URI malformada');
  }

  // cfg.staticDir is resolved absolute once, in config — compare against an
  // exact match or a match with the separator included, so a sibling
  // directory whose name merely starts with the same prefix (e.g.
  // ".../browser-old") can never pass as if it were inside ".../browser".
  const root = cfg.staticDir;
  const requestedPath = normalize(join(root, decodedPath));
  if (requestedPath !== root && !requestedPath.startsWith(root + sep)) {
    return sendJson(res, 400, { error: 'invalid_path' });
  }

  const filePath = await resolveStaticFile(requestedPath, root);
  if (!filePath) return sendJson(res, 404, { error: 'not_found' });

  const contentType = CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(filePath).pipe(res);
}

/** Serves the exact file if it exists, else falls back to index.html (Angular client-side routing). */
async function resolveStaticFile(requestedPath, staticDir) {
  const candidate = requestedPath.endsWith('/') ? join(requestedPath, 'index.html') : requestedPath;
  if (await isFile(candidate)) return candidate;

  const fallback = join(staticDir, 'index.html');
  if (await isFile(fallback)) return fallback;

  return null;
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Entry point — only listens when run directly (`node wiring-editor-server.mjs`),
// never on import.
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const server = createWiringEditorServer(config);
  server.listen(config.port, config.host, () => {
    console.log(`[wiring-editor-server] listening on http://${config.host}:${config.port}`);
    console.log(`[wiring-editor-server] static dir:  ${config.staticDir}`);
    console.log(`[wiring-editor-server] storage dir: ${config.storageDir}`);
  });
}
