// Server tests for the tracer-bullet local persistence service (issue #1).
//
// Uses the project's existing vitest devDependency directly -- this file is
// NOT wired into `ng test` (Angular's unit-test builder only discovers
// specs under src/), so run it through the dedicated package script:
//
//   npm run test:server
//
// Never starts the module's own listener (config.host/config.port): each
// test builds its own server via createWiringEditorServer(cfg) and calls
// server.listen(0, '127.0.0.1') itself for an ephemeral loopback port, torn
// down in afterEach. A fresh temp directory backs storageDir per test file
// run so tests never touch the real ~/.local/share/talus-wiring-editor path.

import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OPERATIONAL_LIMITS } from '../src/app/av-schematic/diagram/model/operational-limits.mjs';
import {
  basePhysicalProject,
  breadboardSurfaceProject,
  canonicalValidationCorpus,
} from '../src/app/av-schematic/diagram/model/canonical-project-corpus.mjs';
import { parseCanonicalProject as parseCanonicalProjectOnServer } from './canonical-project-validate.mjs';
import { createWiringEditorServer } from './wiring-editor-server.mjs';

const HOST = '127.0.0.1';

describe('canonical physical validation corpus', () => {
  for (const testCase of canonicalValidationCorpus) {
    it(testCase.name, () => {
      const parse = () => parseCanonicalProjectOnServer(JSON.parse(JSON.stringify(testCase.raw)));
      if (testCase.accepted) {
        expect(parse).not.toThrow();
      } else {
        expect(parse).toThrow();
      }
    });
  }
});

/**
 * Sends a raw HTTP request via node:http instead of fetch(). Needed for the
 * Host/Origin/Sec-Fetch-Site tests: those are all on the Fetch spec's
 * "forbidden header name" list (Host, Origin, and any `Sec-*` header), so
 * fetch() silently drops them and can't actually exercise this server's
 * header checks -- node:http has no such restriction.
 */
function rawRequest(baseUrl, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolvePromise, reject) => {
    const target = new URL(path, baseUrl);
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolvePromise({ status: res.statusCode }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function baseConfig(storageDir, staticDir) {
  return {
    host: HOST,
    port: 0,
    staticDir,
    storageDir,
    allowedHosts: new Set([`${HOST}:PORT_PLACEHOLDER`]),
  };
}

/** Starts a fresh server on an ephemeral port and returns its base URL + close(). */
async function startServer(cfg) {
  const server = createWiringEditorServer(cfg);
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => resolvePromise(undefined));
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  // allowedHosts is keyed by host:port, and the port is only known after listen() resolves.
  cfg.allowedHosts = new Set([`${HOST}:${port}`]);
  const baseUrl = `http://${HOST}:${port}`;
  return {
    baseUrl,
    port,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose(undefined))),
  };
}

function validProjectPayload() {
  return {
    formatVersion: 4,
    electrical: {
      components: [
        {
          id: 'source',
          deviceId: 'SOURCE',
          manufacturer: '',
          model: '',
          pins: [{ id: 'out', label: 'OUT', direction: 'output' }],
        },
        {
          id: 'load-a',
          deviceId: 'LOAD-A',
          manufacturer: '',
          model: '',
          pins: [{ id: 'in', label: 'IN', direction: 'input' }],
        },
        {
          id: 'load-b',
          deviceId: 'LOAD-B',
          manufacturer: '',
          model: '',
          pins: [{ id: 'in', label: 'IN', direction: 'input' }],
        },
      ],
      junctions: [{ id: 'rail', label: '5 V rail', kind: 'rail' }],
      cables: [
        {
          name: 'HARNESS',
          wireCount: 3,
          colors: ['RD', 'YE', 'BU'],
          wireLabels: ['feed', 'sensor', 'motor'],
          gauge: '0.50 mm2',
        },
        {
          name: 'SPARE',
          wireCount: 2,
          colors: ['#a1b2c3', 'GY'],
          wireLabels: ['unused-a', 'unused-b'],
          notes: 'Disconnected spare cable',
        },
      ],
      nets: [
        {
          id: 'net-5v',
          name: '5V',
          endpoints: [
            { kind: 'pin', componentId: 'source', pinId: 'out' },
            { kind: 'junction', junctionId: 'rail' },
            { kind: 'pin', componentId: 'load-a', pinId: 'in' },
            { kind: 'pin', componentId: 'load-b', pinId: 'in' },
          ],
          conductors: [
            {
              id: 'feed',
              from: { kind: 'pin', componentId: 'source', pinId: 'out' },
              to: { kind: 'junction', junctionId: 'rail' },
              cable: { name: 'HARNESS', wireIndex: 1 },
            },
            {
              id: 'branch-a',
              from: { kind: 'junction', junctionId: 'rail' },
              to: { kind: 'pin', componentId: 'load-a', pinId: 'in' },
              cable: { name: 'HARNESS', wireIndex: 2 },
            },
            {
              id: 'branch-b',
              from: { kind: 'junction', junctionId: 'rail' },
              to: { kind: 'pin', componentId: 'load-b', pinId: 'in' },
              cable: { name: 'HARNESS', wireIndex: 3 },
            },
          ],
        },
      ],
    },
    layout: {
      boards: [],
      components: [
        { componentId: 'source', position: { x: 0, y: 0 }, visualPlane: 10 },
        { componentId: 'load-a', position: { x: 200, y: 0 }, visualPlane: 10 },
        { componentId: 'load-b', position: { x: 200, y: 100 }, visualPlane: 10 },
      ],
      junctions: [{ junctionId: 'rail', position: { x: 100, y: 50 }, visualPlane: 30, taps: 3 }],
      conductors: [
        { conductorId: 'feed', visualPlane: 20, toTap: 0 },
        { conductorId: 'branch-a', visualPlane: 20, fromTap: 1 },
        { conductorId: 'branch-b', visualPlane: 20, fromTap: 2 },
      ],
    },
  };
}

function legacyProjectPayload() {
  return { formatVersion: 1, boards: [], components: [], nets: [] };
}

function legacyConnectedProjectPayload() {
  return {
    formatVersion: 1,
    boards: [],
    components: [
      {
        id: 'source',
        deviceId: 'SOURCE',
        manufacturer: '',
        model: '',
        position: { x: 0, y: 0 },
        pins: [{ id: 'out', label: 'OUT', direction: 'output' }],
      },
      {
        id: 'load',
        deviceId: 'LOAD',
        manufacturer: '',
        model: '',
        position: { x: 100, y: 0 },
        pins: [{ id: 'in', label: 'IN', direction: 'input' }],
      },
    ],
    nets: [
      {
        id: 'wire-a',
        wireId: 'W1',
        colorCode: 'RD',
        source: { componentId: 'source', pinId: 'out' },
        target: { componentId: 'load', pinId: 'in' },
      },
    ],
  };
}

function emptyV2Payload() {
  return {
    formatVersion: 2,
    electrical: { components: [], junctions: [], cables: [], nets: [] },
    layout: { boards: [], components: [], junctions: [], conductors: [] },
  };
}

function detachedFootprintProject() {
  const project = JSON.parse(JSON.stringify(basePhysicalProject()));
  const layout = project.layout.components[0];
  delete layout.placement;
  delete layout.boardId;
  delete layout.pinHoles;
  layout.position = { x: 812.5, y: 433.25 };
  layout.footprintRotation = 90;
  layout.footprintPitch = 17;
  project.electrical.junctions = [];
  project.electrical.cables = [];
  project.electrical.nets = [];
  project.layout.boards = [];
  project.layout.junctions = [];
  project.layout.conductors = [];
  return project;
}

function canonicalCableBudgetPayload(total) {
  const project = emptyV2Payload();
  let remaining = total;
  let index = 0;
  while (remaining >= 2) {
    const wireCount = Math.min(OPERATIONAL_LIMITS.maxWiresPerCable, remaining - 1);
    project.electrical.cables.push({ name: `C${index++}`, wireCount, colors: [] });
    remaining -= wireCount + 1;
  }
  if (remaining !== 0) throw new Error(`cannot represent entity budget ${total}`);
  return project;
}

describe('wiring-editor-server', () => {
  let storageDir;
  let staticDir;
  let cfg;
  let server;

  beforeEach(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'wiring-editor-storage-'));
    staticDir = await mkdtemp(join(tmpdir(), 'wiring-editor-static-'));
    cfg = baseConfig(storageDir, staticDir);
    server = await startServer(cfg);
  });

  afterEach(async () => {
    await server.close();
    await rm(storageDir, { recursive: true, force: true });
    await rm(staticDir, { recursive: true, force: true });
  });

  describe('PUT/GET/list round trip', () => {
    it('creates a project on PUT, then reads it back with GET, then lists it', async () => {
      const project = validProjectPayload();

      const putRes = await fetch(`${server.baseUrl}/api/projects/my-project`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(putRes.status).toBe(200);
      expect(await putRes.json()).toEqual({ id: 'my-project', saved: true });

      const getRes = await fetch(`${server.baseUrl}/api/projects/my-project`);
      expect(getRes.status).toBe(200);
      expect(await getRes.json()).toEqual(project);

      const listRes = await fetch(`${server.baseUrl}/api/projects`);
      expect(listRes.status).toBe(200);
      const { projects } = await listRes.json();
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe('my-project');

      // Written atomically via a scratch file that gets renamed away.
      const onDisk = await readFile(join(storageDir, 'my-project.json'), 'utf8');
      expect(JSON.parse(onDisk)).toEqual(project);
    });

    it('stores and returns the solderless-breadboard surface unchanged', async () => {
      const project = breadboardSurfaceProject();
      const putRes = await fetch(`${server.baseUrl}/api/projects/breadboard`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(putRes.status).toBe(200);

      const saved = await (await fetch(`${server.baseUrl}/api/projects/breadboard`)).json();
      // The visual variant is persisted state, not something the client
      // re-derives from the board's shape on reopen.
      expect(saved.layout.boards[0]).toMatchObject({
        surface: 'breadboard',
        centerGap: 12,
        rowLabels: ['top+', '', 'A'],
      });

      // A board with no surface stays a perfboard and gains no field.
      await fetch(`${server.baseUrl}/api/projects/plain`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(basePhysicalProject()),
      });
      const plain = await (await fetch(`${server.baseUrl}/api/projects/plain`)).json();
      expect(plain.layout.boards[0]).not.toHaveProperty('surface');
    });

    it('rejects a breadboard surface the renderer could not draw', async () => {
      const project = breadboardSurfaceProject();
      delete project.layout.boards[0].centerGap;

      const putRes = await fetch(`${server.baseUrl}/api/projects/broken-breadboard`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(putRes.status).toBe(400);

      const getRes = await fetch(`${server.baseUrl}/api/projects/broken-breadboard`);
      expect(getRes.status).toBe(404);
    });

    it('serves the same current project version to two independent clients', async () => {
      const project = validProjectPayload();
      await fetch(`${server.baseUrl}/api/projects/shared`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });

      const [clientA, clientB] = await Promise.all([
        fetch(`${server.baseUrl}/api/projects/shared`),
        fetch(`${server.baseUrl}/api/projects/shared`),
      ]);
      expect(await clientA.json()).toEqual(project);
      expect(await clientB.json()).toEqual(project);
    });

    it('preserves and normalizes the complete physical v2 layout without centerGap', async () => {
      const putRes = await fetch(`${server.baseUrl}/api/projects/physical`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(basePhysicalProject()),
      });
      expect(putRes.status).toBe(200);

      const getRes = await fetch(`${server.baseUrl}/api/projects/physical`);
      const saved = await getRes.json();
      expect(saved.electrical.nets[0].name).toBe('AUTHORED');
      expect(saved.layout.boards[0]).toMatchObject({
        pitch: 17,
        holeDiameter: 5,
        traces: [{ id: 'vcc', net: 'VCC' }],
      });
      expect(saved.layout.boards[0]).not.toHaveProperty('centerGap');
      expect(saved.layout.components[0]).toMatchObject({
        footprintId: 'inline-link',
        position: { x: 30.25, y: 57.25 },
        pinHoles: [
          { pinId: 'a', hole: { row: 2, col: 1 } },
          { pinId: 'b', hole: { row: 2, col: 2 } },
        ],
      });
      expect(saved.layout.junctions[0].boardPort).toBe('trace:vcc');
      expect(saved.layout.conductors.every((layout) => layout.physicalBinding)).toBe(true);
    });

    it('preserves detached footprint geometry through PUT and GET', async () => {
      const project = detachedFootprintProject();
      const putRes = await fetch(`${server.baseUrl}/api/projects/detached-footprint`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(putRes.status).toBe(200);

      const getRes = await fetch(`${server.baseUrl}/api/projects/detached-footprint`);
      expect(getRes.status).toBe(200);
      const saved = await getRes.json();
      expect(saved.layout.components[0]).toMatchObject({
        position: { x: 812.5, y: 433.25 },
        footprintRotation: 90,
        footprintPitch: 17,
      });
    });

    it('preserves and applies centerGap and board notes', async () => {
      const project = basePhysicalProject();
      project.layout.boards[0].notes = 'Bulk incorporado';
      project.layout.boards[0].centerGap = 12;
      const putRes = await fetch(`${server.baseUrl}/api/projects/physical-gap`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(putRes.status).toBe(200);

      const getRes = await fetch(`${server.baseUrl}/api/projects/physical-gap`);
      const saved = await getRes.json();
      expect(saved.layout.boards[0]).toMatchObject({
        notes: 'Bulk incorporado',
        centerGap: 12,
      });
      expect(saved.layout.components[0].position).toEqual({ x: 30.25, y: 69.25 });
    });

    it('continues accepting legacy v1 snapshots for older clients', async () => {
      const res = await fetch(`${server.baseUrl}/api/projects/legacy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(legacyProjectPayload()),
      });
      expect(res.status).toBe(200);
    });

    it('recovers legacy points without routingMode and drops only malformed geometry', async () => {
      const recoverable = legacyConnectedProjectPayload();
      recoverable.nets[0].points = [
        { x: 0, y: 0 },
        { x: 0.5, y: 20 },
        { x: 100, y: 20 },
      ];
      recoverable.nets[0].gauge = '22 AWG';
      recoverable.nets[0].length = '120 mm';
      recoverable.nets[0].note = 'Rota legada';

      const recoveredRes = await fetch(`${server.baseUrl}/api/projects/legacy-route`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recoverable),
      });
      expect(recoveredRes.status).toBe(200);
      const recovered = await (await fetch(`${server.baseUrl}/api/projects/legacy-route`)).json();
      expect(recovered.nets[0]).toMatchObject({
        routingMode: 'manual',
        points: recoverable.nets[0].points,
        gauge: '22 AWG',
        length: '120 mm',
        note: 'Rota legada',
      });

      const malformed = legacyConnectedProjectPayload();
      malformed.nets[0].routingMode = 'manual';
      malformed.nets[0].points = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ];
      const malformedRes = await fetch(`${server.baseUrl}/api/projects/legacy-malformed-route`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(malformed),
      });
      expect(malformedRes.status).toBe(200);
      const stored = await (
        await fetch(`${server.baseUrl}/api/projects/legacy-malformed-route`)
      ).json();
      expect(stored.nets[0].routingMode).toBeUndefined();
      expect(stored.nets[0].points).toBeUndefined();
    });

    it('returns 404 for GET of a project id that was never saved', async () => {
      const res = await fetch(`${server.baseUrl}/api/projects/does-not-exist`);
      expect(res.status).toBe(404);
    });

    it('deletes a project and then 404s on it', async () => {
      await fetch(`${server.baseUrl}/api/projects/to-delete`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validProjectPayload()),
      });

      const delRes = await fetch(`${server.baseUrl}/api/projects/to-delete`, { method: 'DELETE' });
      expect(delRes.status).toBe(200);

      const getRes = await fetch(`${server.baseUrl}/api/projects/to-delete`);
      expect(getRes.status).toBe(404);
    });
  });

  describe('invalid project id', () => {
    it('routes an empty id segment to the list endpoint instead of rejecting it', async () => {
      const res = await fetch(`${server.baseUrl}/api/projects/`);
      expect(res.status).toBe(200);
    });

    it('normalizes ".." out of the URL before routing sees it, landing on the static 404 fallback', async () => {
      // WHATWG URL parsing (new URL(req.url, base) in handleRequest) collapses
      // "/api/projects/.." to "/api/" before segment-based routing runs, so
      // this never reaches the :id validation at all -- it's not a bypass,
      // just a different (still safe) code path.
      const res = await fetch(`${server.baseUrl}/api/projects/..`);
      expect(res.status).toBe(404);
    });

    it.each(['.hidden', 'a/b', 'has space', 'x'.repeat(200)])(
      'rejects %j with 400',
      async (rawId) => {
        const res = await fetch(`${server.baseUrl}/api/projects/${encodeURIComponent(rawId)}`);
        expect(res.status).toBe(400);
      },
    );
  });

  describe('extra route segments', () => {
    it('rejects /api/projects/:id/extra with 404', async () => {
      const res = await fetch(`${server.baseUrl}/api/projects/my-project/extra`);
      expect(res.status).toBe(404);
    });

    it('does not treat /api/projectsFOO as the projects API', async () => {
      // Falls through to static serving, which 404s with no static dir contents.
      const res = await fetch(`${server.baseUrl}/api/projectsFOO`);
      expect(res.status).toBe(404);
    });
  });

  describe('path traversal containment', () => {
    it('normalizes ../ so it never resolves outside staticDir (safe 404, never a leaked file)', async () => {
      const res = await fetch(`${server.baseUrl}/../../../etc/passwd`);
      expect(res.status).toBe(404);
    });
  });

  describe('malformed request URI', () => {
    it('returns 400 for an unterminated percent-escape in the path', async () => {
      const res = await fetch(`${server.baseUrl}/%`);
      expect(res.status).toBe(400);
    });
  });

  describe('malformed JSON body', () => {
    it('returns 400, not 500, for invalid JSON on PUT', async () => {
      const res = await fetch(`${server.baseUrl}/api/projects/broken`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{ this is not json',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for a structurally invalid CanonicalProjectV2', async () => {
      const res = await fetch(`${server.baseUrl}/api/projects/broken`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formatVersion: 2,
          electrical: { components: [], junctions: [], cables: [], nets: [] },
          layout: { boards: [], components: [], junctions: [] },
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 415 when Content-Type is not application/json', async () => {
      const res = await fetch(`${server.baseUrl}/api/projects/broken`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(validProjectPayload()),
      });
      expect(res.status).toBe(415);
    });
  });

  describe('canonical v1/v2/v3 validation parity', () => {
    it('migrates v2 visual planes deterministically', async () => {
      const project = validProjectPayload();
      project.formatVersion = 2;
      for (const collection of [
        project.layout.boards,
        project.layout.components,
        project.layout.junctions,
        project.layout.conductors,
      ]) {
        for (const entry of collection) delete entry.visualPlane;
      }
      const res = await fetch(`${server.baseUrl}/api/projects/migrated-planes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(res.status).toBe(200);
      const stored = await (await fetch(`${server.baseUrl}/api/projects/migrated-planes`)).json();
      expect(stored.formatVersion).toBe(4);
      expect(stored.layout.components.every((item) => item.visualPlane === 10)).toBe(true);
      expect(stored.layout.junctions.every((item) => item.visualPlane === 30)).toBe(true);
      expect(stored.layout.conductors.every((item) => item.visualPlane === 20)).toBe(true);
    });

    it('stores per-conductor metadata with a tolerant orthogonal manual route', async () => {
      const project = validProjectPayload();
      Object.assign(project.electrical.nets[0].conductors[0], {
        colorCode: 'YE',
        gauge: '22 AWG',
        length: '120 mm',
        notes: 'Rota principal',
      });
      Object.assign(project.layout.conductors[0], {
        routingMode: 'manual',
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 20 },
          { x: 100, y: 20 },
        ],
      });

      const res = await fetch(`${server.baseUrl}/api/projects/manual-route`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(res.status).toBe(200);
      const stored = await (await fetch(`${server.baseUrl}/api/projects/manual-route`)).json();
      expect(stored.electrical.nets[0].conductors[0]).toMatchObject({
        colorCode: 'YE',
        gauge: '22 AWG',
        length: '120 mm',
        notes: 'Rota principal',
      });
      expect(stored.layout.conductors[0]).toMatchObject({
        routingMode: 'manual',
        points: project.layout.conductors[0].points,
      });
    });

    it('rejects a deterministic conductor color/colorCode conflict', async () => {
      const project = validProjectPayload();
      Object.assign(project.electrical.nets[0].conductors[0], {
        color: '#e2231a',
        colorCode: 'YE',
      });
      const res = await fetch(`${server.baseUrl}/api/projects/color-conflict`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(res.status).toBe(400);
    });

    it.each([
      [
        'points without manual mode',
        {
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 20 },
          ],
        },
      ],
      ['manual without points', { routingMode: 'manual' }],
      [
        'diagonal manual route',
        {
          routingMode: 'manual',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
        },
      ],
    ])('rejects %s', async (_label, route) => {
      const project = validProjectPayload();
      Object.assign(project.layout.conductors[0], route);
      const res = await fetch(`${server.baseUrl}/api/projects/invalid-route`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(res.status).toBe(400);
    });

    it.each([
      ['below', OPERATIONAL_LIMITS.maxPinsPerComponent - 1, 200],
      ['at', OPERATIONAL_LIMITS.maxPinsPerComponent, 200],
      ['above', OPERATIONAL_LIMITS.maxPinsPerComponent + 1, 400],
    ])('enforces the pin-count limit %s the boundary', async (_label, pinCount, status) => {
      const project = emptyV2Payload();
      project.electrical.components.push({
        id: 'x1',
        deviceId: 'X1',
        manufacturer: '',
        model: '',
        pins: Array.from({ length: pinCount }, (_, index) => ({
          id: `p${index}`,
          label: `P${index}`,
          direction: 'output',
        })),
      });
      project.layout.components.push({ componentId: 'x1', position: { x: 0, y: 0 } });

      const res = await fetch(`${server.baseUrl}/api/projects/pin-limit-${pinCount}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(res.status).toBe(status);
    });

    it.each([
      ['below', OPERATIONAL_LIMITS.maxWiresPerCable - 1, 200],
      ['at', OPERATIONAL_LIMITS.maxWiresPerCable, 200],
      ['above', OPERATIONAL_LIMITS.maxWiresPerCable + 1, 400],
    ])('enforces the wire-count limit %s the boundary', async (_label, wireCount, status) => {
      const project = emptyV2Payload();
      project.electrical.cables.push({ name: 'C', wireCount, colors: [] });
      const res = await fetch(`${server.baseUrl}/api/projects/wire-limit-${wireCount}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(res.status).toBe(status);
    });

    it.each([
      ['below', OPERATIONAL_LIMITS.maxJunctionTaps - 1, 200],
      ['at', OPERATIONAL_LIMITS.maxJunctionTaps, 200],
      ['above', OPERATIONAL_LIMITS.maxJunctionTaps + 1, 400],
    ])('enforces the junction-tap limit %s the boundary', async (_label, taps, status) => {
      const project = emptyV2Payload();
      project.electrical.junctions.push({ id: 'j1', label: 'J1', kind: 'rail' });
      project.layout.junctions.push({
        junctionId: 'j1',
        position: { x: 0, y: 0 },
        taps,
      });
      const res = await fetch(`${server.baseUrl}/api/projects/junction-tap-limit-${taps}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(res.status).toBe(status);
    });

    it.each([
      ['below', OPERATIONAL_LIMITS.maxTotalEntities - 1, 200],
      ['at', OPERATIONAL_LIMITS.maxTotalEntities, 200],
      ['above', OPERATIONAL_LIMITS.maxTotalEntities + 1, 400],
    ])('enforces the total-entity limit %s the boundary', async (_label, total, status) => {
      const project = canonicalCableBudgetPayload(total);
      const res = await fetch(`${server.baseUrl}/api/projects/entity-limit-${total}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(res.status).toBe(status);
    });

    it('rejects unsafe integer capacities', async () => {
      const project = emptyV2Payload();
      project.electrical.cables.push({
        name: 'C',
        wireCount: Number.MAX_SAFE_INTEGER + 1,
        colors: [],
      });
      const res = await fetch(`${server.baseUrl}/api/projects/unsafe-integer`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(res.status).toBe(400);
    });

    it('normalizes unused cable color and wirelabel slots before storage', async () => {
      const project = validProjectPayload();
      const spare = project.electrical.cables.find((cable) => cable.name === 'SPARE');
      spare.colors = ['#a1b2c3'];
      spare.wireLabels = ['unused-a'];

      const putRes = await fetch(`${server.baseUrl}/api/projects/normalized`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(putRes.status).toBe(200);

      const getRes = await fetch(`${server.baseUrl}/api/projects/normalized`);
      const stored = await getRes.json();
      expect(stored.electrical.cables.find((cable) => cable.name === 'SPARE')).toMatchObject({
        colors: ['#a1b2c3', ''],
        wireLabels: ['unused-a', ''],
      });
    });

    it('rejects a legacy wire whose two ends are the same endpoint', async () => {
      const project = legacyConnectedProjectPayload();
      project.nets[0].target = { componentId: 'source', pinId: 'out' };

      const res = await fetch(`${server.baseUrl}/api/projects/legacy-self-loop`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(res.status).toBe(400);
    });

    it('rejects conflicting effective colors for a reused legacy wire id', async () => {
      const project = legacyConnectedProjectPayload();
      project.nets.push({ ...structuredClone(project.nets[0]), id: 'wire-b', colorCode: 'BU' });

      const res = await fetch(`${server.baseUrl}/api/projects/legacy-color-conflict`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(res.status).toBe(400);
    });

    it('accepts an internal loop and rejects the same loop when backed by a cable', async () => {
      const project = validProjectPayload();
      const source = project.electrical.components.find((component) => component.id === 'source');
      source.pins.push(
        { id: 'loop-a', label: 'LOOP-A', direction: 'output' },
        { id: 'loop-b', label: 'LOOP-B', direction: 'output' },
      );
      project.electrical.nets.push({
        id: 'internal-loop-net',
        name: '',
        endpoints: [
          { kind: 'pin', componentId: 'source', pinId: 'loop-a' },
          { kind: 'pin', componentId: 'source', pinId: 'loop-b' },
        ],
        conductors: [
          {
            id: 'internal-loop',
            from: { kind: 'pin', componentId: 'source', pinId: 'loop-a' },
            to: { kind: 'pin', componentId: 'source', pinId: 'loop-b' },
            wirevizLoop: true,
          },
        ],
      });
      project.layout.conductors.push({ conductorId: 'internal-loop', visualPlane: 20 });

      const accepted = await fetch(`${server.baseUrl}/api/projects/internal-loop`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(accepted.status).toBe(200);

      project.electrical.nets.at(-1).conductors[0].cable = { name: 'HARNESS', wireIndex: 1 };
      const rejected = await fetch(`${server.baseUrl}/api/projects/cable-loop`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      expect(rejected.status).toBe(400);
    });

    it('rejects canonical and dangerous keys inside preserved extras', async () => {
      const reserved = validProjectPayload();
      reserved.electrical.components[0].wirevizExtras = { type: 'override' };
      const reservedRes = await fetch(`${server.baseUrl}/api/projects/reserved-extra`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reserved),
      });
      expect(reservedRes.status).toBe(400);

      const dangerous = validProjectPayload();
      dangerous.electrical.cables[0].wirevizExtras = JSON.parse('{"x":{"__proto__":"bad"}}');
      const dangerousRes = await fetch(`${server.baseUrl}/api/projects/dangerous-extra`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dangerous),
      });
      expect(dangerousRes.status).toBe(400);
    });
  });

  describe('oversized payload', () => {
    it('returns 413 for a body over the 5 MB limit', async () => {
      const hugeBody = JSON.stringify({ padding: 'x'.repeat(6 * 1024 * 1024) });
      const res = await fetch(`${server.baseUrl}/api/projects/too-big`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: hugeBody,
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: 'payload_too_large' });
    });
  });

  describe('Host / Origin allowlisting', () => {
    // fetch() cannot set Host/Origin/Sec-Fetch-* (Fetch spec "forbidden header
    // names"), so these use rawRequest (node:http) to actually control them.

    it('rejects a request whose Host header is not on the allowlist (DNS rebinding)', async () => {
      const res = await rawRequest(server.baseUrl, '/api/projects', {
        headers: { Host: 'attacker.example:1234' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects a PUT whose Origin header does not match the request Host', async () => {
      const res = await rawRequest(server.baseUrl, '/api/projects/x', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
        body: JSON.stringify(validProjectPayload()),
      });
      expect(res.status).toBe(403);
    });

    it('rejects a PUT whose Sec-Fetch-Site is cross-site', async () => {
      const res = await rawRequest(server.baseUrl, '/api/projects/x', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
        body: JSON.stringify(validProjectPayload()),
      });
      expect(res.status).toBe(403);
    });

    it('accepts a PUT with no Origin/Sec-Fetch-Site header at all (documented curl workflow)', async () => {
      const res = await rawRequest(server.baseUrl, '/api/projects/x', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validProjectPayload()),
      });
      expect(res.status).toBe(200);
    });

    it('accepts a PUT with a matching same-origin Origin header', async () => {
      const res = await rawRequest(server.baseUrl, '/api/projects/x', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: server.baseUrl },
        body: JSON.stringify(validProjectPayload()),
      });
      expect(res.status).toBe(200);
    });
  });
});
