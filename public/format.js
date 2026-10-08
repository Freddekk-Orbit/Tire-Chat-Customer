const LABELS = {
  waiting: 'Waiting',
  working: 'Working',
  ready: 'Ready',
  pickup: 'On the way',
  delivered: 'Handed over'
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

export function formatTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatClock(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

export function scheduleLine(car) {
  if (!car?.scheduledStart) return '';
  const start = formatClock(car.scheduledStart);
  const end = car.scheduledEnd ? formatClock(car.scheduledEnd) : '';
  if (car.status === 'ready' || car.status === 'pickup') return `Booked ${start}`;
  if (car.status === 'working') return end ? `Ready around ${end}` : `Booked ${start}`;
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
