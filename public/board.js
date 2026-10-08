import { dayList, escapeHtml, formatClock, formatTime, groups, labelFor, scheduleLine, setShopTimezone } from './format.js';
import { watchState } from './live.js';

const dot = document.querySelector('#dot');
const connection = document.querySelector('#connection');
const clock = document.querySelector('#clock');
const empty = document.querySelector('#empty');
const readyZone = document.querySelector('#ready-zone');
const workingZone = document.querySelector('#working-zone');
const waitingZone = document.querySelector('#waiting-zone');
const dayZone = document.querySelector('#day-zone');
const readyHint = document.querySelector('#ready-hint');
const readyGrid = document.querySelector('#ready');
const workingGrid = document.querySelector('#working');
const waitingRow = document.querySelector('#waiting');
const dayGrid = document.querySelector('#day');

const seen = new Set();
let primed = false;
let lastCars = '';

function tick() {
  const now = Date.now();
  clock.textContent = formatTime(now);
  clock.dateTime = new Date(now).toISOString();
}

function card(car, flash) {
  const name = car.name ? `<p class="name">${escapeHtml(car.name)}</p>` : '';
  const when = scheduleLine(car);
  const time = when ? `<p class="when">${escapeHtml(when)}</p>` : '';
  return `<article class="card ${car.status}${flash ? ' flash' : ''}">
    <span class="band" aria-hidden="true"></span>
    <p class="label">${escapeHtml(labelFor(car.status))}</p>
    <p class="plate">${escapeHtml(car.plate)}</p>
    ${name}
    ${time}
  </article>`;
}

function dayRow(car) {
  const when = car.scheduledStart
    ? `${formatClock(car.scheduledStart)}${car.scheduledEnd ? `–${formatClock(car.scheduledEnd)}` : ''}`
    : 'Drop-in';
  const extra = [car.service, car.status === 'waiting' ? '' : labelFor(car.status)].filter(Boolean).join(' · ');
  return `<article class="slot ${car.status}">
    <time>${escapeHtml(when)}</time>
    <p class="plate">${escapeHtml(car.plate)}</p>
    <p class="note">${escapeHtml(extra || 'Booked')}</p>
  </article>`;
}

function fill(grid, cars, fresh) {
  const bucket = cars.length <= 1 ? '1' : cars.length === 2 ? '2' : 'more';
  grid.dataset.n = bucket;
  if (!cars.length) {
    grid.innerHTML = '<p class="quiet">None right now</p>';
    return;
  }
  grid.innerHTML = cars.map((car) => card(car, fresh.has(car.id))).join('');
}

function render(cars) {
  const view = groups(cars);
  const today = dayList(cars);
  const scheduled = today.filter((car) => car.scheduledStart);
  const walkIns = view.waiting.filter((car) => !car.scheduledStart);
  const active = view.ready.length + view.working.length + view.waiting.length;
  const fresh = new Set();
  if (primed) {
    for (const car of view.ready) {
      const key = `${car.id}:${car.status}:${car.updatedAt}`;
      if (!seen.has(key)) fresh.add(car.id);
    }
  }
  for (const car of cars) seen.add(`${car.id}:${car.status}:${car.updatedAt}`);
  primed = true;

  empty.hidden = active !== 0;
  readyZone.hidden = view.ready.length === 0;
  workingZone.hidden = view.working.length === 0;
  dayZone.hidden = scheduled.length === 0;
  waitingZone.hidden = walkIns.length === 0;

  const onTheWayOnly = view.ready.length > 0 && view.ready.every((car) => car.status === 'pickup');
  readyHint.textContent = onTheWayOnly ? 'On the way out to you' : 'We will bring the car out to you';
  if (view.ready.length) fill(readyGrid, view.ready, fresh);
  if (view.working.length) fill(workingGrid, view.working, fresh);
  if (scheduled.length) dayGrid.innerHTML = scheduled.map(dayRow).join('');
  waitingRow.innerHTML = `<div class="chips">${walkIns
    .map((car) => `<span class="chip">${escapeHtml(car.plate)}</span>`)
    .join('')}</div>`;

  const readyCount = view.ready.length;
  document.title = readyCount ? `(${readyCount} ready) Workshop` : 'Workshop';
}

tick();
setInterval(tick, 1000);

watchState((state) => {
  setShopTimezone(state.timeZone);
  const key = JSON.stringify(state.cars);
  if (key === lastCars) return;
  lastCars = key;
  render(state.cars);
}, (status) => {
  dot.classList.toggle('live', status === 'live');
  connection.hidden = status === 'live';
  connection.textContent = status === 'reconnecting'
    ? 'Reconnecting to the workshop computer…'
    : 'Connecting to the workshop computer…';
});
