import { escapeHtml, formatTime, groups, labelFor } from './format.js';
import { watchState } from './live.js';

const DESK_KEY = 'workshop-desk';
const ACK_KEY = 'workshop-acked';
const ACTIONS = [
  ['working', 'Start'],
  ['ready', 'Ready'],
  ['pickup', 'On the way'],
  ['delivered', 'Handed over']
];
const NEXT = { waiting: 'working', working: 'ready', ready: 'pickup', pickup: 'delivered' };

const live = document.querySelector('#live');
const alerts = document.querySelector('#alerts');
const form = document.querySelector('#add-form');
const formError = document.querySelector('#form-error');
const carList = document.querySelector('#car-list');
const doneList = document.querySelector('#done-list');
const clearDeliveredButton = document.querySelector('#clear-delivered');
const share = document.querySelector('#share');
const messages = document.querySelector('#messages');
const chatForm = document.querySelector('#chat-form');
const chatError = document.querySelector('#chat-error');
const deskButtons = [...document.querySelectorAll('[data-desk]')];
const whoLabel = document.querySelector('#who-label');

const acked = new Set(JSON.parse(localStorage.getItem(ACK_KEY) || '[]'));
const knownAlerts = new Set();
const localMarks = new Set();
let desk = localStorage.getItem(DESK_KEY) || '';
let latest = { cars: [], messages: [] };
let lastCars = '';
let lastMessages = '';
let primed = false;
let audioContext;

function saveAck() {
  localStorage.setItem(ACK_KEY, JSON.stringify([...acked].slice(-200)));
}

function paintDesk() {
  for (const button of deskButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.desk === desk));
  }
  whoLabel.textContent = desk ? `This computer is ${desk === 'workshop' ? 'Workshop' : 'Office'}` : 'Which computer is this?';
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The workshop computer did not accept that.');
  return data;
}

function showError(node, error) {
  node.hidden = !error;
  node.textContent = error ? error.message : '';
}

function chime() {
  try {
    audioContext = audioContext || new AudioContext();
    const now = audioContext.currentTime;
    for (const [frequency, offset] of [[523.25, 0], [659.25, 0.12], [783.99, 0.24]]) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.07, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.32);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.36);
    }
  } catch {
    // A blocked chime still leaves the on-screen alert.
  }
}

function alertKey(car) {
  return `${car.id}:${car.status}:${car.updatedAt}`;
}

function renderAlerts(cars) {
  const pending = cars.filter((car) => car.status === 'ready' || car.status === 'pickup');
  const fresh = [];
  for (const car of pending) {
    const key = alertKey(car);
    if (acked.has(key)) continue;
    if (primed && !knownAlerts.has(key) && !localMarks.has(`${car.id}:${car.status}`)) fresh.push(car);
    knownAlerts.add(key);
    localMarks.delete(`${car.id}:${car.status}`);
  }
  primed = true;
  if (fresh.length) chime();

  const visible = pending.filter((car) => !acked.has(alertKey(car)));
  alerts.innerHTML = visible.map((car) => {
    const name = car.name ? ` · ${escapeHtml(car.name)}` : '';
    const driving = car.status === 'pickup';
    return `<article class="alert">
      <div>
        <strong>${escapeHtml(car.plate)}${name}</strong>
        <p>${driving ? 'On the way out to the customer.' : 'Ready. Drive the car out to the customer.'}</p>
      </div>
      <div class="alert-actions">
        ${driving ? '' : '<button type="button" data-alert="pickup">On the way</button>'}
        <button type="button" data-alert="delivered">Handed over</button>
        <button type="button" class="ghost" data-alert="hide">Hide</button>
      </div>
    </article>`;
  }).join('');

  for (const [article, car] of [...alerts.querySelectorAll('.alert')].map((article, index) => [article, visible[index]])) {
    article.querySelectorAll('[data-alert]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.alert === 'hide') {
          acked.add(alertKey(car));
          saveAck();
          renderAlerts(cars);
          return;
        }
        setStatus(car.id, button.dataset.alert);
      });
    });
  }
}

function actionButtons(car) {
  const next = NEXT[car.status];
  return ACTIONS.map(([status, label]) => {
    const className = status === car.status ? 'current' : status === next ? '' : 'ghost';
    return `<button type="button" class="${className}" data-id="${car.id}" data-status="${status}">${label}</button>`;
  }).join('') + `<button type="button" class="danger" data-id="${car.id}" data-remove="true">Remove</button>`;
}

function carRow(car) {
  const name = car.name ? escapeHtml(car.name) : 'No name';
  return `<article class="car">
    <div>
      <p class="plate">${escapeHtml(car.plate)}</p>
      <p class="meta">${name} · ${escapeHtml(labelFor(car.status))} · ${escapeHtml(formatTime(car.updatedAt))}</p>
    </div>
    <div class="row-actions">${actionButtons(car)}</div>
  </article>`;
}

function renderCars(cars) {
  const view = groups(cars);
  const sections = [
    ['Drive out', view.ready],
    ['In the workshop', view.working],
    ['Waiting', view.waiting]
  ];
  carList.innerHTML = sections.map(([title, list]) => {
    if (!list.length) return '';
    return `<section class="group"><h2>${title}</h2>${list.map(carRow).join('')}</section>`;
  }).join('') || '<p class="empty-note">No cars on the board yet.</p>';

  doneList.innerHTML = view.delivered.map((car) => `<div class="history-row">
    <div>
      <strong>${escapeHtml(car.plate)}</strong>
      <span class="meta"> ${car.name ? escapeHtml(car.name) : ''} · ${escapeHtml(formatTime(car.updatedAt))}</span>
    </div>
    <button type="button" class="ghost" data-id="${car.id}" data-status="pickup">Undo</button>
  </div>`).join('') || '<p class="empty-note">None yet today.</p>';
}

function renderMessages(list) {
  const stick = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
  messages.innerHTML = list.map((message) => {
    const mine = message.from === desk;
    const who = message.from === 'workshop' ? 'Workshop' : 'Office';
    return `<article class="msg ${message.from}${mine ? ' mine' : ''}">
      <p class="who">${who} · ${escapeHtml(formatTime(message.at))}</p>
      <p>${escapeHtml(message.text)}</p>
    </article>`;
  }).join('') || '<p class="empty-note">No messages yet.</p>';
  if (stick || lastMessages === '') messages.scrollTop = messages.scrollHeight;
}

async function setStatus(id, status) {
  localMarks.add(`${id}:${status}`);
  try {
    await request(`/api/cars/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    showError(formError, null);
  } catch (error) {
    localMarks.delete(`${id}:${status}`);
    showError(formError, error);
  }
}

carList.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.remove) {
    request(`/api/cars/${button.dataset.id}`, { method: 'DELETE' }).catch((error) => showError(formError, error));
    return;
  }
  if (button.dataset.status) setStatus(button.dataset.id, button.dataset.status);
});

doneList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-status]');
  if (button) setStatus(button.dataset.id, button.dataset.status);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  const body = {
    plate: new FormData(form).get('plate'),
    name: new FormData(form).get('name'),
    status: submitter?.value || 'working'
  };
  form.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  try {
    await request('/api/cars', { method: 'POST', body: JSON.stringify(body) });
    form.reset();
    form.plate.focus();
    showError(formError, null);
  } catch (error) {
    showError(formError, error);
  } finally {
    form.querySelectorAll('button').forEach((button) => { button.disabled = false; });
  }
});

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!desk) {
    showError(chatError, new Error('Choose Workshop or Office first.'));
    return;
  }
  const text = new FormData(chatForm).get('text');
  chatForm.querySelector('button').disabled = true;
  try {
    await request('/api/chat', { method: 'POST', body: JSON.stringify({ from: desk, text }) });
    chatForm.reset();
    showError(chatError, null);
  } catch (error) {
    showError(chatError, error);
  } finally {
    chatForm.querySelector('button').disabled = false;
  }
});

clearDeliveredButton.addEventListener('click', () => {
  request('/api/clear-delivered', { method: 'POST', body: '{}' }).catch((error) => showError(formError, error));
});

for (const button of deskButtons) {
  button.addEventListener('click', () => {
    desk = button.dataset.desk;
    localStorage.setItem(DESK_KEY, desk);
    paintDesk();
    lastMessages = '';
    renderMessages(latest.messages);
    lastMessages = JSON.stringify(latest.messages) + desk;
  });
}

fetch('/api/info')
  .then((response) => response.json())
  .then((info) => {
    const board = info.board[0];
    const staff = info.staff[0];
    share.innerHTML = board
      ? `<p><strong>Customers:</strong> open ${escapeHtml(board)} in Chrome and press F11.</p>
         <p><strong>You and the crew:</strong> open ${escapeHtml(staff)} on each computer, then pick Workshop or Office.</p>`
      : '<p>Customers use /status, full screen with F11. You and the crew use /chat. On the other computers, use this machine’s network address instead of localhost.</p>';
  })
  .catch(() => {
    share.textContent = 'Addresses will show here when the workshop computer is reachable.';
  });

paintDesk();
document.addEventListener('pointerdown', () => {
  if (audioContext) audioContext.resume().catch(() => {});
}, { once: true });

watchState((next) => {
  latest = next;
  const carsKey = JSON.stringify(next.cars);
  if (carsKey !== lastCars) {
    lastCars = carsKey;
    renderCars(next.cars);
    renderAlerts(next.cars);
  }
  const messageKey = JSON.stringify(next.messages) + desk;
  if (messageKey !== lastMessages) {
    lastMessages = messageKey;
    renderMessages(next.messages);
  }
}, (status) => {
  live.textContent = status === 'live' ? 'Live' : 'Reconnecting…';
  live.classList.toggle('ok', status === 'live');
});
