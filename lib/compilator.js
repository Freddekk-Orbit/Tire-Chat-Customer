import { parseDayplan } from './dayplan.js';
import { dayKey, shopTimezone } from './clock.js';

export function tirehotelConfig() {
  return {
    timeZone: shopTimezone(),
    icsUrl: process.env.TIREHOTEL_ICS_URL || '',
    apiUrl: process.env.TIREHOTEL_API_URL || '',
    apiKey: process.env.TIREHOTEL_API_KEY || '',
    apiPath: process.env.TIREHOTEL_API_PATH || '/api/calendar/bookings',
    companyId: process.env.TIREHOTEL_COMPANY_ID || '',
    branchId: process.env.TIREHOTEL_BRANCH_ID || '',
    label: process.env.TIREHOTEL_LABEL || 'Däckhotellet / Autowork'
  };
}

export function syncConfigured(config = tirehotelConfig()) {
  return Boolean(config.icsUrl || (config.apiUrl && config.apiKey));
}

function authHeaders(config) {
  const headers = { accept: 'application/json, text/calendar, text/plain' };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  return headers;
}

function dayBounds(date) {
  return {
    from: `${date}T00:00:00`,
    to: `${date}T23:59:59`
  };
}

async function readBody(response) {
  const text = await response.text();
  const type = response.headers.get('content-type') || '';
  if (type.includes('json') || text.startsWith('{') || text.startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export async function fetchDayBookings(options = {}) {
  const config = { ...tirehotelConfig(), ...options };
  const timeZone = config.timeZone || shopTimezone();
  const date = options.date || dayKey(options.now ?? Date.now(), timeZone);
  const parseOptions = { date, timeZone, now: options.now };

  if (config.icsUrl) {
    const response = await fetch(config.icsUrl, { headers: authHeaders(config) });
    if (!response.ok) {
      return { error: `Kalenderflödet från däckhotellet svarade med ${response.status}.`, status: 502 };
    }
    const bookings = parseDayplan(await response.text(), parseOptions);
    return { bookings, source: 'ics', date, label: config.label };
  }

  if (!config.apiUrl || !config.apiKey) {
    return {
      error: 'Lägg till TIREHOTEL_ICS_URL, eller TIREHOTEL_API_URL och TIREHOTEL_API_KEY, för att hämta dagen automatiskt.',
      status: 503
    };
  }

  const bounds = dayBounds(date);
  const url = new URL(config.apiPath, config.apiUrl.endsWith('/') ? config.apiUrl : `${config.apiUrl}/`);
  url.searchParams.set('from', bounds.from);
  url.searchParams.set('to', bounds.to);
  url.searchParams.set('date', date);
  if (config.companyId) url.searchParams.set('companyId', config.companyId);
  if (config.branchId) url.searchParams.set('branchId', config.branchId);

  const response = await fetch(url, { headers: authHeaders(config) });
  if (!response.ok) {
    return { error: `Däckhotellets API svarade med ${response.status}.`, status: 502 };
  }
  const body = await readBody(response);
  const bookings = parseDayplan(body, parseOptions);
  return { bookings, source: 'api', date, label: config.label };
}
