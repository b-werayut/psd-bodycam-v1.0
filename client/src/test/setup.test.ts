import { expect, it } from 'vitest';

it('blocks real network requests', () => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/x');
  expect(() => xhr.send()).toThrow('[test setup] real network request blocked: GET /api/x');
});
it('clears localStorage between tests (part 1)', () => {
  localStorage.setItem('k', 'v');
});
it('clears localStorage between tests (part 2)', () => {
  expect(localStorage.getItem('k')).toBeNull();
});
