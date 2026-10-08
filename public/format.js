const LABELS = {
  waiting: 'Väntar',
  working: 'I arbete',
  ready: 'Klar',
  pickup: 'På väg',
  delivered: 'Utlämnad'
};

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

export function labelFor(status) {
  return LABELS[status] || status;
}

let shopTimeZone = 'Europe/Stockholm';

export function setShopTimezone(timeZone) {
  if (timeZone) shopTimeZone = timeZone;
}

function swedishClock(ms, timeZone = shopTimeZone) {
  return new Date(ms).toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone
  }).replace(/\s/g, '').replace(':', '.');
}

export function formatTime(ms) {
  return swedishClock(ms);
}

export function formatClock(ms) {
  if (!ms) return '';
  return swedishClock(ms);
}

export function formatDate(value, timeZone = shopTimeZone) {
  if (!value) return '';
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  return date.toLocaleDateString('sv-SE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone
  });
}

export function formatPlate(value) {
  const compact = String(value ?? '').toUpperCase().replace(/\s+/g, '');
  if (/^[A-ZÅÄÖ]{3}\d{2}[A-ZÅÄÖ0-9]$/.test(compact)) return `${compact.slice(0, 3)} ${compact.slice(3)}`;
  return String(value ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export function carsLabel(count) {
  return count === 1 ? '1 bil' : `${count} bilar`;
}

export function scheduleLine(car) {
  if (!car?.scheduledStart) return '';
  const start = formatClock(car.scheduledStart);
  const end = car.scheduledEnd ? formatClock(car.scheduledEnd) : '';
  if (car.status === 'ready' || car.status === 'pickup') return `Bokad ${start}`;
  if (car.status === 'working') return end ? `Klar ca ${end}` : `Bokad ${start}`;
  return end ? `${start}–${end}` : start;
}

export function dayList(cars) {
  return cars
    .filter((car) => car.status !== 'delivered')
    .slice()
    .sort((a, b) => (a.scheduledStart || a.createdAt) - (b.scheduledStart || b.createdAt));
}

export function groups(cars) {
  const byUpdatedDesc = (a, b) => b.updatedAt - a.updatedAt;
  const bySchedule = (a, b) => (a.scheduledStart || a.createdAt) - (b.scheduledStart || b.createdAt);
  return {
    ready: cars.filter((car) => car.status === 'ready' || car.status === 'pickup').sort(byUpdatedDesc),
    working: cars.filter((car) => car.status === 'working').sort(byUpdatedDesc),
    waiting: cars.filter((car) => car.status === 'waiting').sort(bySchedule),
    delivered: cars.filter((car) => car.status === 'delivered').sort(byUpdatedDesc)
  };
}
