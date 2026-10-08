import { randomUUID } from 'node:crypto';

export const STATUSES = ['waiting', 'working', 'ready', 'pickup', 'delivered'];
export const DESKS = ['workshop', 'office'];
const ACTIVE = new Set(['waiting', 'working', 'ready', 'pickup']);
const DAY_MS = 36 * 60 * 60 * 1000;

export function emptyState() {
  return { cars: [], messages: [] };
}

export function cleanText(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

export function normalizePlate(value) {
  const plate = cleanText(value, 16).toUpperCase().replace(/\s+/g, ' ');
  if (!/^[A-Z0-9][A-Z0-9 -]{0,11}$/.test(plate)) return null;
  return plate;
}

export function normalizeName(value) {
  return cleanText(value, 40);
}

export function prune(state, now = Date.now()) {
  const cutoff = now - DAY_MS;
  state.cars = state.cars.filter((car) => car.status !== 'delivered' || car.updatedAt >= cutoff);
  state.messages = state.messages.filter((message) => message.at >= cutoff).slice(-300);
  return state;
}

export function addCar(state, input, now = Date.now()) {
  const plate = normalizePlate(input?.plate);
  if (!plate) return { error: 'Enter a plate, like ABC 123.', status: 400 };
  const name = normalizeName(input?.name);
  const requested = input?.status ?? 'waiting';
  if (requested !== 'waiting' && requested !== 'working') {
    return { error: 'A new car can start as waiting or working.', status: 400 };
  }
  const duplicate = state.cars.some((car) => car.plate === plate && ACTIVE.has(car.status));
  if (duplicate) return { error: 'That plate is already on the board.', status: 409 };
  const car = {
    id: randomUUID(),
    plate,
    name,
    status: requested,
    createdAt: now,
    updatedAt: now
  };
  state.cars.push(car);
  prune(state, now);
  return { car };
}

export function setStatus(state, id, status, now = Date.now()) {
  if (!STATUSES.includes(status)) return { error: 'Unknown status.', status: 400 };
  const car = state.cars.find((item) => item.id === id);
  if (!car) return { error: 'That car is no longer on the board.', status: 404 };
  car.status = status;
  car.updatedAt = now;
  prune(state, now);
  return { car };
}

export function removeCar(state, id) {
  const index = state.cars.findIndex((car) => car.id === id);
  if (index === -1) return { error: 'That car is no longer on the board.', status: 404 };
  const [car] = state.cars.splice(index, 1);
  return { car };
}

export function addMessage(state, input, now = Date.now()) {
  const from = input?.from;
  if (!DESKS.includes(from)) return { error: 'Choose Workshop or Office.', status: 400 };
  const text = cleanText(input?.text, 500);
  if (!text) return { error: 'Write a message first.', status: 400 };
  const message = { id: randomUUID(), from, text, at: now };
  state.messages.push(message);
  prune(state, now);
  return { message };
}

export function clearDelivered(state) {
  const before = state.cars.length;
  state.cars = state.cars.filter((car) => car.status !== 'delivered');
  return { removed: before - state.cars.length };
}
