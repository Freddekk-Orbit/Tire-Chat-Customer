export const DEFAULT_TZ = 'Europe/Stockholm';

function pad(value) {
  return String(value).padStart(2, '0');
}

function partMap(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(ms));
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second')
  };
}

function offsetAt(utcMs, timeZone) {
  const local = partMap(utcMs, timeZone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return asUtc - utcMs;
}

export function zonedDateTimeToUtc(year, month, day, hour, minute, timeZone = DEFAULT_TZ) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = desired - offsetAt(desired, timeZone);
  const shifted = offsetAt(utc, timeZone);
  if (shifted !== offsetAt(desired, timeZone)) utc = desired - shifted;
  return utc;
}

export function dayKey(ms, timeZone = DEFAULT_TZ) {
  const local = partMap(ms, timeZone);
  return `${local.year}-${pad(local.month)}-${pad(local.day)}`;
}

export function parseClock(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})[.:](\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function timeOnDay(date, clock, timeZone = DEFAULT_TZ) {
  const day = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!day || !clock) return null;
  return zonedDateTimeToUtc(Number(day[1]), Number(day[2]), Number(day[3]), clock.hour, clock.minute, timeZone);
}

export function formatClock(ms, timeZone = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(ms)).replace(/\s/g, '').replace(':', '.');
}

export function shopTimezone() {
  return process.env.SHOP_TIMEZONE || DEFAULT_TZ;
}

export function defaultSlotMinutes() {
  const minutes = Number(process.env.TIREHOTEL_SLOT_MINUTES);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 20;
}
