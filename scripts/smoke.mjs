import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addCar, addMessage, clearDelivered, emptyState, prune, setStatus } from '../lib/state.js';
import { applyBookings, parseDayplan } from '../lib/dayplan.js';
import { dayKey, timeOnDay, zonedDateTimeToUtc } from '../lib/clock.js';
import { carsLabel, escapeHtml, formatClock, formatDate, formatPlate, groups, scheduleLine } from '../public/format.js';
import { readFile } from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 8791;
let server;
let dataDir;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`ok ${message}`);
}

async function request(urlPath, options) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, options);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (server.exitCode != null) throw new Error('server exited before it was ready');
    try {
      const { response } = await request('/api/health');
      if (response.ok) return;
    } catch {
      // Retry until the port is open.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('server did not start');
}

function readEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async nextState() {
      const started = Date.now();
      while (Date.now() - started < 3000) {
        let splitAt = buffer.indexOf('\n\n');
        if (splitAt === -1) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          continue;
        }
        const part = buffer.slice(0, splitAt);
        buffer = buffer.slice(splitAt + 2);
        if (!part.includes('event: state')) continue;
        const line = part.split('\n').find((item) => item.startsWith('data: '));
        return JSON.parse(line.slice(6));
      }
      throw new Error('timed out waiting for a board update');
    },
    close() {
      reader.cancel().catch(() => {});
    }
  };
}

function unitTests() {
  assert(escapeHtml(`<a "b" & '>`) === '&lt;a &quot;b&quot; &amp; &#39;&gt;', 'escapes text for the board');
  const state = emptyState();
  const created = addCar(state, { plate: ' ab c123 ', name: ' Anna ', status: 'working' }, 1_000);
  assert(created.car.plate === 'AB C123' && created.car.status === 'working', 'normalizes a new car');
  assert(addCar(state, { plate: 'ab c123' }).error, 'rejects a plate already on the board');
  assert(setStatus(state, created.car.id, 'ready', 2_000).car.status === 'ready', 'marks a car ready');
  assert(setStatus(state, created.car.id, 'pickup', 3_000).car.status === 'pickup', 'marks a car on the way');
  const view = groups(state.cars);
  assert(view.ready.length === 1 && view.working.length === 0, 'groups an on-the-way car with ready');
  setStatus(state, created.car.id, 'delivered', 4_000);
  assert(clearDelivered(state).removed === 1 && state.cars.length === 0, 'clears handed-over cars');
  const stale = emptyState();
  stale.cars.push({ id: 'old', plate: 'OLD 1', name: '', status: 'delivered', createdAt: 1, updatedAt: 1 });
  stale.messages.push({ id: 'm', from: 'office', text: 'old', at: 1 });
  prune(stale, 36 * 60 * 60 * 1000 + 5);
  assert(stale.cars.length === 0 && stale.messages.length === 0, 'drops yesterday’s handed-over cars and chat');
  assert(addMessage(emptyState(), { from: 'lobby', text: 'hi' }).error, 'rejects an unknown desk');

  const tz = 'Europe/Stockholm';
  const summer = zonedDateTimeToUtc(2026, 10, 8, 8, 0, tz);
  assert(summer === Date.UTC(2026, 9, 8, 6, 0, 0), 'maps a Stockholm morning slot to UTC in summer time');
  assert(dayKey(summer, tz) === '2026-10-08', 'keeps the shop date for a booked slot');
  assert(timeOnDay('2026-01-15', { hour: 8, minute: 0 }, tz) === Date.UTC(2026, 0, 15, 7, 0, 0), 'maps a winter morning slot');

  const print = parseDayplan('08:00-08:20  ABC123  Anna Andersson  Däckhotell\n08:20 DEF456 Erik Skifte', {
    date: '2026-10-08',
    timeZone: tz,
    slotMinutes: 20
  });
  assert(print.length === 2 && print[0].plate === 'ABC123' && print[0].name === 'Anna Andersson', 'reads a printed Tirehotel day list');
  assert(print[0].scheduledStart === summer && print[0].scheduledEnd === summer + 20 * 60_000, 'keeps start and ready times from the printout');

  const csv = parseDayplan('tid;regnr;kund;tjänst;sluttid\n07:00;ABC 123;Anna;Däckhotell;07:20', {
    date: '2026-10-08',
    timeZone: tz
  });
  assert(csv[0].plate === 'ABC 123' && csv[0].service === 'Däckhotell', 'reads a Tirehotel CSV export');

  const ics = parseDayplan([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Europe/Stockholm:20261008T080000',
    'DTEND;TZID=Europe/Stockholm:20261008T082000',
    'SUMMARY:ABC123 Anna Andersson',
    'DESCRIPTION:Däckhotell',
    'UID:aw-1',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\n'), { date: '2026-10-08', timeZone: tz });
  assert(ics[0].externalId === 'aw-1' && ics[0].scheduledStart === summer, 'reads an Autowork calendar feed');

  const json = parseDayplan({
    bookings: [{ registrationNumber: 'GHI789', start: '2026-10-08T08:00:00+02:00', customerName: 'Lisa', serviceName: 'Däckskifte' }]
  }, { date: '2026-10-08', timeZone: tz });
  assert(json[0].plate === 'GHI789' && json[0].name === 'Lisa', 'reads a Tirehotel API booking list');

  const board = emptyState();
  const first = applyBookings(board, print, { now: summer, date: '2026-10-08', timeZone: tz, source: 'compilator' });
  assert(first.added === 2 && board.cars[0].status === 'waiting', 'puts the day list on the board as waiting cars');
  board.cars[0].status = 'working';
  const again = applyBookings(board, print.slice(0, 1), { now: summer, date: '2026-10-08', timeZone: tz, source: 'compilator' });
  assert(again.updated === 1 && board.cars[0].status === 'working', 'does not reset a car already in the workshop');
  assert(!board.cars.some((car) => car.plate === 'DEF456'), 'drops a cancelled waiting booking on the next load');
  assert(scheduleLine(board.cars[0]).includes('Klar ca'), 'berättar för kunden när en bil i verkstaden ska vara klar');
  assert(formatClock(summer) === '08.00', 'skriver klockslag på svenska med punkt');
  assert(formatDate('2026-10-08') === '8 oktober 2026', 'skriver datum på svenska');
  assert(formatPlate('ABC123') === 'ABC 123' && formatPlate('abc 12a') === 'ABC 12A', 'skriver svenska regnr med mellanslag');
  assert(carsLabel(1) === '1 bil' && carsLabel(3) === '3 bilar', 'böjer ordet bil');
}

async function main() {
  unitTests();
  dataDir = await mkdtemp(path.join(tmpdir(), 'workshop-board-'));
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_FILE: path.join(dataDir, 'state.json') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  server.stdout.on('data', (chunk) => { logs += chunk; });
  server.stderr.on('data', (chunk) => { logs += chunk; });
  try {
    await waitForHealth();
    const board = await fetch(`http://127.0.0.1:${port}/status`);
    const crew = await fetch(`http://127.0.0.1:${port}/chat`);
    assert(board.ok && (await board.text()).includes('När är min bil klar?'), 'visar kundskärmen på svenska');
    assert(crew.ok && (await crew.text()).includes('Idag från däckhotellet'), 'visar disken för dagens däckhotell');
    const home = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
    const oldCrew = await fetch(`http://127.0.0.1:${port}/staff`, { redirect: 'manual' });
    assert(home.status === 302 && home.headers.get('location') === '/status', 'sends / to /status');
    assert(oldCrew.status === 302 && oldCrew.headers.get('location') === '/chat', 'sends /staff to /chat');

    const bad = await request('/api/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plate: '!!!' })
    });
    assert(bad.response.status === 400, 'rejects a plate the board cannot show');

    const events = await fetch(`http://127.0.0.1:${port}/events`);
    const stream = readEvents(events);
    const initial = await stream.nextState();
    assert(Array.isArray(initial.cars), 'sends the current board on connect');

    const created = await request('/api/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plate: 'abc 123', name: 'Anna', status: 'working' })
    });
    assert(created.response.status === 201 && created.data.car.plate === 'ABC 123', 'starts a car from the desk');
    const id = created.data.car.id;
    const duplicate = await request('/api/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plate: 'ABC 123' })
    });
    assert(duplicate.response.status === 409, 'keeps the same plate from being added twice');

    let snapshot = await stream.nextState();
    assert(snapshot.cars.some((car) => car.id === id && car.status === 'working'), 'pushes a new car to open screens');

    for (const status of ['ready', 'pickup', 'delivered']) {
      const updated = await request(`/api/cars/${id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status })
      });
      assert(updated.response.ok && updated.data.car.status === status, `updates status to ${status}`);
      snapshot = await stream.nextState();
      assert(snapshot.cars.find((car) => car.id === id).status === status, `live board shows ${status}`);
    }

    const chat = await request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'workshop', text: 'ABC 123 is done' })
    });
    assert(chat.response.status === 201, 'accepts a workshop message');
    snapshot = await stream.nextState();
    assert(snapshot.messages.at(-1).text === 'ABC 123 is done', 'pushes chat to the other computer');
    const emptyChat = await request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'office', text: '   ' })
    });
    assert(emptyChat.response.status === 400, 'rejects an empty chat message');

    const removed = await request('/api/clear-delivered', { method: 'POST' });
    assert(removed.response.ok && removed.data.removed === 1, 'clears a handed-over car');

    const sample = await readFile(path.join(root, 'examples/tirehotel-day.csv'), 'utf8');
    const imported = await request('/api/dayplan/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: sample })
    });
    assert(imported.response.ok && imported.data.added === 3, 'loads the sample Tirehotel day onto the board');
    const loaded = await request('/api/state');
    assert(loaded.data.cars.some((car) => car.plate === 'ABC 123' && car.scheduledStart), 'stores booked plates and timestamps');
    const dayplan = await request('/api/dayplan');
    assert(dayplan.data.bookings === 3 && dayplan.data.syncConfigured === false, 'reports the loaded Tirehotel day');
    stream.close();
  } catch (error) {
    console.error(logs);
    throw error;
  }
}

main()
  .then(() => console.log('smoke passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server && server.exitCode == null) {
      server.kill('SIGTERM');
      await new Promise((resolve) => server.once('exit', resolve));
    }
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });
