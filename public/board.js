import { escapeHtml, groups, labelFor } from './format.js';
import { watchState } from './live.js';

const dot = document.querySelector('#dot');
const connection = document.querySelector('#connection');
const clock = document.querySelector('#clock');
const empty = document.querySelector('#empty');
const readyZone = document.querySelector('#ready-zone');
const workingZone = document.querySelector('#working-zone');
const waitingZone = document.querySelector('#waiting-zone');
const readyHint = document.querySelector('#ready-hint');
const readyGrid = document.querySelector('#ready');
const workingGrid = document.querySelector('#working');
const waitingRow = document.querySelector('#waiting');

const seen = new Set();
let primed = false;
let lastCars = '';

function tick() {
  clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  clock.dateTime = new Date().toISOString();
}

function card(car, flash) {
  const name = car.name ? `<p class="name">${escapeHtml(car.name)}</p>` : '';
  return `<article class="card ${car.status}${flash ? ' flash' : ''}">
    <span class="band" aria-hidden="true"></span>
    <p class="label">${escapeHtml(labelFor(car.status))}</p>
    <p class="plate">${escapeHtml(car.plate)}</p>
    ${name}
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
  waitingZone.hidden = view.waiting.length === 0;

  const onTheWayOnly = view.ready.length > 0 && view.ready.every((car) => car.status === 'pickup');
  readyHint.textContent = onTheWayOnly ? 'On the way out to you' : 'We will bring the car out to you';
  if (view.ready.length) fill(readyGrid, view.ready, fresh);
  if (view.working.length) fill(workingGrid, view.working, fresh);
  waitingRow.innerHTML = `<div class="chips">${view.waiting
    .map((car) => `<span class="chip">${escapeHtml(car.plate)}</span>`)
    .join('')}</div>`;

  const readyCount = view.ready.length;
  document.title = readyCount ? `(${readyCount} ready) Workshop` : 'Workshop';
}

tick();
setInterval(tick, 1000);

watchState((state) => {
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
