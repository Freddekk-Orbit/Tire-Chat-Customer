import { randomUUID } from 'node:crypto';
import {
  cleanText,
  normalizeName,
  normalizePlate,
  prune
} from './state.js';
import {
  dayKey,
  defaultSlotMinutes,
  parseClock,
  shopTimezone,
  timeOnDay
} from './clock.js';

const ACTIVE = new Set(['waiting', 'working', 'ready', 'pickup']);
const HEADER_ALIASES = {
  start: ['start', 'tid', 'time', 'from', 'från', 'fran', 'starttid', 'bokad'],
  end: ['end', 'sluttid', 'till', 'to', 'klar', 'ready', 'endtime'],
  plate: ['plate', 'regnr', 'reg', 'registreringsnummer', 'reg.nr', 'regnummer', 'licenseplate', 'registrationnumber'],
  name: ['name', 'kund', 'customer', 'namn', 'förare', 'forare', 'kontakt'],
  service: ['service', 'tjänst', 'tjanst', 'typ', 'arbete', 'job'],
  calendar: ['calendar', 'kalender', 'lyft', 'lift', 'bay'],
  id: ['id', 'bookingid', 'externalid', 'bokningsid', 'appointmentid']
};

export function emptyDayplan() {
  return {
    date: null,
    source: null,
    importedAt: null,
    label: 'Däckhotellet',
    bookings: 0
  };
}

function headerKey(value) {
  const key = String(value ?? '')
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[^a-z0-9åäö.]+/gi, '');
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(key)) return field;
  }
  return null;
}

function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && (character === ';' || character === ',' || character === '\t')) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  cells.push(current.trim());
  return cells;
}

function looksLikeHeader(cells) {
  return cells.filter((cell) => headerKey(cell)).length >= 2;
}

export function extractPlate(value) {
  const text = String(value ?? '').toUpperCase();
  const match = text.match(/\b([A-Z]{3}\s?\d{2}[A-Z0-9])\b/);
  return match ? normalizePlate(match[1]) : normalizePlate(value);
}

function bookingFromParts(parts, date, timeZone, slotMinutes) {
  const plate = extractPlate(parts.plate || parts.summary || '');
  if (!plate) return null;
  const startClock = parseClock(parts.start);
  if (!startClock) return null;
  const scheduledStart = timeOnDay(date, startClock, timeZone);
  if (scheduledStart == null) return null;
  const endClock = parseClock(parts.end);
  const scheduledEnd = endClock
    ? timeOnDay(date, endClock, timeZone)
    : scheduledStart + slotMinutes * 60_000;
  return {
    plate,
    name: normalizeName(parts.name),
    service: cleanText(parts.service || parts.calendar, 80),
    scheduledStart,
    scheduledEnd,
    externalId: cleanText(parts.id, 80) || null
  };
}

function parseDelimited(text, date, timeZone, slotMinutes) {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/^\ufeff/, '').trim()).filter(Boolean);
  if (!lines.length) return [];
  const first = splitCsvLine(lines[0]);
  if (!looksLikeHeader(first)) return [];
  const columns = first.map(headerKey);
  if (!columns.includes('plate') || !columns.includes('start')) return [];
  const bookings = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const parts = {};
    columns.forEach((column, index) => {
      if (column) parts[column] = cells[index] || '';
    });
    const booking = bookingFromParts(parts, date, timeZone, slotMinutes);
    if (booking) bookings.push(booking);
  }
  return bookings;
}

function parsePrintLines(text, date, timeZone, slotMinutes) {
  const bookings = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\ufeff/, '').trim();
    if (!line || /^(tid|time|datum|date|kalender|lyft)\b/i.test(line)) continue;
    const match = line.match(/^(\d{1,2}[.:]\d{2})(?:\s*[-–]\s*(\d{1,2}[.:]\d{2}))?\s+(.+)$/);
    if (!match) continue;
    const rest = match[3].replace(/\s+/g, ' ').trim();
    const plate = extractPlate(rest);
    if (!plate) continue;
    const afterPlate = rest.replace(new RegExp(plate.replace(/\s+/g, '\\s*'), 'i'), '').trim();
    const serviceMatch = afterPlate.match(/\b(däckhotell|dackhotell|däckskifte|dackskifte|skifte|omläggning|omlaggning|balansering|hjultvätt|hjultvatt|punkttering|tvätt|tvatt|express)\b/i);
    const booking = bookingFromParts({
      start: match[1],
      end: match[2] || '',
      plate,
      name: serviceMatch ? afterPlate.slice(0, serviceMatch.index).trim() : afterPlate,
      service: serviceMatch ? serviceMatch[0] : ''
    }, date, timeZone, slotMinutes);
    if (booking) bookings.push(booking);
  }
  return bookings;
}

function unfoldIcs(text) {
  return text.replace(/\r?\n[ \t]/g, '');
}

function icsDate(value, timeZone) {
  const match = String(value).match(/^(?:TZID=([^:]+):)?(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return null;
  const year = Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  const hour = Number(match[5]);
  const minute = Number(match[6]);
  if (match[8] === 'Z') return Date.UTC(year, month - 1, day, hour, minute, Number(match[7]));
  return timeOnDay(`${year}-${match[3]}-${match[4]}`, { hour, minute }, match[1] || timeZone);
}

function parseIcs(text, fallbackDate, timeZone, slotMinutes) {
  if (!/BEGIN:VEVENT/i.test(text)) return [];
  const bookings = [];
  const blocks = unfoldIcs(text).split(/BEGIN:VEVENT/i).slice(1);
  for (const block of blocks) {
    const fields = {};
    for (const line of block.split(/\r?\n/)) {
      const match = line.match(/^([^:;]+)(?:;[^:]*)?:(.*)$/);
      if (match) fields[match[1].toUpperCase()] = match[2].trim();
    }
    const start = icsDate(fields.DTSTART, timeZone);
    if (start == null) continue;
    const date = dayKey(start, timeZone);
    if (fallbackDate && date !== fallbackDate) continue;
    const end = fields.DTEND ? icsDate(fields.DTEND, timeZone) : start + slotMinutes * 60_000;
    const blob = [fields.SUMMARY, fields.DESCRIPTION, fields.LOCATION].filter(Boolean).join(' ');
    const plate = extractPlate(blob);
    if (!plate) continue;
    bookings.push({
      plate,
      name: normalizeName((fields.SUMMARY || '').replace(plate, '')),
      service: cleanText(fields.DESCRIPTION, 80),
      scheduledStart: start,
      scheduledEnd: end,
      externalId: cleanText(fields.UID, 80) || null
    });
  }
  return bookings;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['bookings', 'items', 'data', 'result', 'appointments', 'events']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function field(record, names) {
  for (const name of names) {
    if (record[name] != null && record[name] !== '') return record[name];
    const lower = Object.keys(record).find((key) => key.toLowerCase() === name.toLowerCase());
    if (lower && record[lower] != null && record[lower] !== '') return record[lower];
  }
  return '';
}

function parseJsonBookings(value, date, timeZone, slotMinutes) {
  const bookings = [];
  for (const record of asList(value)) {
    if (!record || typeof record !== 'object') continue;
    const startRaw = field(record, ['start', 'startTime', 'from', 'fromTime', 'bookedFrom', 'scheduledStart', 'tid']);
    let startClock = parseClock(startRaw);
    let bookingDate = date;
    if (!startClock && typeof startRaw === 'string' && startRaw.includes('T')) {
      const start = Date.parse(startRaw);
      if (Number.isFinite(start)) {
        bookingDate = dayKey(start, timeZone);
        const clock = new Intl.DateTimeFormat('sv-SE', {
          timeZone,
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23'
        }).format(new Date(start));
        startClock = parseClock(clock);
      }
    }
    const endRaw = field(record, ['end', 'endTime', 'to', 'toTime', 'bookedTo', 'scheduledEnd', 'klar']);
    const booking = bookingFromParts({
      start: startClock ? `${startClock.hour}:${String(startClock.minute).padStart(2, '0')}` : startRaw,
      end: parseClock(endRaw) ? endRaw : '',
      plate: field(record, ['plate', 'regNr', 'regnr', 'registrationNumber', 'licensePlate', 'vehicleRegNo', 'reg']),
      name: field(record, ['name', 'customer', 'customerName', 'driver', 'kontakt']),
      service: field(record, ['service', 'serviceName', 'job', 'type']),
      id: field(record, ['id', 'bookingId', 'externalId', 'uid'])
    }, bookingDate, timeZone, slotMinutes);
    if (booking) bookings.push(booking);
  }
  return bookings;
}

export function parseDayplan(input, options = {}) {
  const timeZone = options.timeZone || shopTimezone();
  const slotMinutes = options.slotMinutes || defaultSlotMinutes();
  const date = options.date || dayKey(options.now ?? Date.now(), timeZone);
  const text = typeof input === 'string' ? input : '';
  if (typeof input === 'object' && input) {
    const fromJson = parseJsonBookings(input, date, timeZone, slotMinutes);
    if (fromJson.length) return fromJson;
  }
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const fromJson = parseJsonBookings(JSON.parse(trimmed), date, timeZone, slotMinutes);
      if (fromJson.length) return fromJson;
    } catch {
      // Fall through to the print and CSV readers.
    }
  }
  const fromIcs = parseIcs(trimmed, date, timeZone, slotMinutes);
  if (fromIcs.length) return fromIcs;
  const fromCsv = parseDelimited(trimmed, date, timeZone, slotMinutes);
  if (fromCsv.length) return fromCsv;
  return parsePrintLines(trimmed, date, timeZone, slotMinutes);
}

function sameBooking(car, booking) {
  if (booking.externalId && car.externalId && car.externalId === booking.externalId) return true;
  return car.plate === booking.plate && ACTIVE.has(car.status);
}

export function applyBookings(state, bookings, options = {}) {
  const now = options.now ?? Date.now();
  const timeZone = options.timeZone || shopTimezone();
  const source = options.source || 'compilator';
  const date = options.date || dayKey(now, timeZone);
  const incoming = bookings.filter((booking) => dayKey(booking.scheduledStart, timeZone) === date);
  let added = 0;
  let updated = 0;
  for (const booking of incoming) {
    const existing = state.cars.find((car) => sameBooking(car, booking));
    if (existing) {
      existing.scheduledStart = booking.scheduledStart;
      existing.scheduledEnd = booking.scheduledEnd;
      existing.service = booking.service || existing.service || '';
      existing.source = existing.source || source;
      existing.externalId = booking.externalId || existing.externalId || null;
      if (!existing.name && booking.name) existing.name = booking.name;
      updated += 1;
      continue;
    }
    state.cars.push({
      id: randomUUID(),
      plate: booking.plate,
      name: booking.name || '',
      status: 'waiting',
      createdAt: now,
      updatedAt: now,
      scheduledStart: booking.scheduledStart,
      scheduledEnd: booking.scheduledEnd,
      service: booking.service || '',
      source,
      externalId: booking.externalId
    });
    added += 1;
  }

  let removed = 0;
  if (options.dropMissing !== false) {
    const keep = new Set(incoming.map((booking) => booking.externalId || booking.plate));
    state.cars = state.cars.filter((car) => {
      const fromFeed = car.source === source && car.status === 'waiting';
      const sameDay = car.scheduledStart && dayKey(car.scheduledStart, timeZone) === date;
      if (!fromFeed || !sameDay) return true;
      const key = car.externalId || car.plate;
      if (keep.has(key)) return true;
      removed += 1;
      return false;
    });
  }

  state.dayplan = {
    date,
    source,
    importedAt: now,
    label: options.label || 'Däckhotellet',
    bookings: incoming.length
  };
  prune(state, now, timeZone);
  return { added, updated, removed, bookings: incoming.length, date };
}
