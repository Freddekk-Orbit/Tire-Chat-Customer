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

export function groups(cars) {
  const byUpdatedDesc = (a, b) => b.updatedAt - a.updatedAt;
  const byCreatedAsc = (a, b) => a.createdAt - b.createdAt;
  return {
    ready: cars.filter((car) => car.status === 'ready' || car.status === 'pickup').sort(byUpdatedDesc),
    working: cars.filter((car) => car.status === 'working').sort(byUpdatedDesc),
    waiting: cars.filter((car) => car.status === 'waiting').sort(byCreatedAsc),
    delivered: cars.filter((car) => car.status === 'delivered').sort(byUpdatedDesc)
  };
}
