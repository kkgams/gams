import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { rulerGeometry, labelPose, letterPoses, heroLetterPoses, positionedLetters, easeOutScroll } from '../promo/scroll-geometry.js';

test('promo ruler maps page endpoints and handles short pages', () => {
  const start = rulerGeometry(0, 1000, 6000);
  const end = rulerGeometry(5000, 1000, 6000);
  assert.equal(start.progress, 0);
  assert.equal(end.progress, 1);
  assert.equal(end.offset + 6000, 940);
  for (const scroll of [-100, 0, 10000]) {
    const geometry = rulerGeometry(scroll, 1000, 500);
    assert.equal(geometry.range, 0);
    assert.equal(geometry.progress, 0);
    assert.ok(Object.values(geometry).every(Number.isFinite));
  }
});

const options = { index: 2, count: 7, width: 1440, height: 1000, textWidth: 250, top: 760, nextTop: 1800 };
const widths = Array(10).fill(25);

test('promo letters stagger independently, with discrete reduced-motion poses', () => {
  const letters = letterPoses(options, widths);
  assert.equal(letters[0].angle, 0);
  assert.ok(letters.at(-1).angle < -45);
  const reduced = letterPoses({ ...options, reduced: true }, widths);
  assert.equal(new Set(reduced.map(pose => pose.angle)).size, 1);
  const hero = { ...options, index: 0, reduced: true };
  assert.deepEqual(heroLetterPoses(hero, widths, 100), positionedLetters(labelPose(hero), widths));
});

test('hero letters start at the measured wordmark and finish at the ruler', () => {
  const hero = { ...options, index: 0, heroOrigin: { x: 180, y: 160, size: 32 } };
  assert.deepEqual(heroLetterPoses(hero, widths, 0), positionedLetters({ x: 180, y: 160, size: 32, angle: 0, opacity: 1 }, widths));
  assert.deepEqual(heroLetterPoses(hero, widths, 500), positionedLetters(labelPose(hero), widths));
  for (const scroll of [0, 100, 250, 499, 500]) {
    for (const pose of heroLetterPoses(hero, widths, scroll)) assert.ok(Object.values(pose).every(Number.isFinite));
  }
});

test('last promo label finishes in the compact list even when its section cannot reach the top', () => {
  const lastWidths = Array(11).fill(22);
  for (const height of [900, 1337, 1800]) for (const reduced of [false, true]) {
    const last = { index: 6, count: 7, width: 1440, height, textWidth: 242, top: height - 1062, nextTop: height * 2, remainingScroll: 0, reduced };
    const letters = letterPoses(last, lastWidths);
    assert.ok(letters.every(pose => pose.angle === 0 && pose.size === 14 && pose.y === 196 && Math.abs(pose.opacity - 0.45) < 1e-12));
    assert.deepEqual(letters, positionedLetters(labelPose(last), lastWidths));
    const sample = remainingScroll => letterPoses({ ...last, top: last.top + remainingScroll, nextTop: last.nextTop + remainingScroll, remainingScroll }, lastWidths);
    const distances = [500, 390, 300, 170, 100, 1, 0];
    assert.deepEqual([...distances].reverse().map(sample).reverse(), distances.map(sample));
    if (!reduced) {
      assert.ok(sample(170).every(pose => pose.angle === 0 && pose.size === 34));
      assert.ok(sample(1).every((pose, i) => Math.abs(pose.x - letters[i].x) < 0.01 && Math.abs(pose.y - letters[i].y) < 0.01));
    }
  }
});

test('promo label paths remain finite and reversible on narrow viewports', () => {
  for (const width of [320, 375, 700, 1440]) for (const height of [320, 812, 1000]) {
    const positions = Array.from({ length: 100 }, (_, i) => 1200 - i * 20);
    const sample = top => letterPoses({ ...options, width, height, top, nextTop: top + 700 }, widths);
    const forward = positions.map(sample);
    assert.deepEqual([...positions].reverse().map(sample).reverse(), forward);
    for (const letters of forward) for (const pose of letters) {
      assert.ok(Object.values(pose).every(Number.isFinite));
      assert.ok(pose.opacity >= 0 && pose.opacity <= 1);
    }
  }
});

const themeScript = await readFile(new URL('../promo/theme.js', import.meta.url), 'utf8');

function themeFixture({ saved = null, light = false, blocked = false } = {}) {
  const events = {};
  const button = { hidden: true, setAttribute(key, value) { this[key] = value; }, addEventListener(key, handler) { events[key] = handler; } };
  const root = { dataset: {}, classList: { add() {} } };
  const meta = {};
  const warnings = [];
  const system = { matches: light, addEventListener(key, handler) { events.systemChange = handler; } };
  const storage = { getItem() { if (blocked) throw { name: 'SecurityError' }; return saved; }, setItem(key, value) { if (blocked) throw { name: 'SecurityError' }; saved = value; } };
  runInNewContext(themeScript, {
    document: { documentElement: root, querySelectorAll: () => [button], querySelector: () => meta, addEventListener(key, handler) { events.ready = handler; } },
    matchMedia: () => system, localStorage: storage, console: { warn: (...args) => warnings.push(args) },
  });
  events.ready();
  return { root, button, meta, system, events, warnings, saved: () => saved };
}

test('theme preference applies before paint, updates controls, and is saved', () => {
  const state = themeFixture({ saved: 'light' });
  assert.equal(state.root.dataset.theme, 'light');
  assert.equal(state.button['aria-label'], 'Switch to dark theme');
  assert.equal(state.button.hidden, false);
  assert.equal(state.meta.content, '#f4f3ef');
  state.events.click();
  assert.equal(state.root.dataset.theme, 'dark');
  assert.equal(state.saved(), 'dark');
  assert.equal(state.button['aria-label'], 'Switch to light theme');
});

test('theme follows the system until the visitor chooses explicitly', () => {
  const state = themeFixture({ light: true });
  assert.equal(state.root.dataset.theme, 'light');
  state.system.matches = false;
  state.events.systemChange();
  assert.equal(state.root.dataset.theme, 'dark');
  state.events.click();
  state.events.systemChange();
  assert.equal(state.root.dataset.theme, 'light');
});

test('theme still switches when browser storage is unavailable', () => {
  const state = themeFixture({ blocked: true });
  state.events.click();
  assert.equal(state.root.dataset.theme, 'light');
  assert.equal(state.warnings.length, 2);
});

test('promo scroll easing is bounded, monotonic, and has exact endpoints', () => {
  assert.equal(easeOutScroll(0), 0);
  assert.equal(easeOutScroll(1), 1);
  const values = Array.from({ length: 101 }, (_, i) => easeOutScroll(i / 100));
  assert.ok(values.every((value, i) => value >= 0 && value <= 1 && (!i || value >= values[i - 1])));
});
