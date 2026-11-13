import { clamp, rulerGeometry, letterPoses, heroLetterPoses, easeOutScroll } from './scroll-geometry.js';

/** Add data-scroll-label="TITLE" to sections with unique ids. Returns cleanup. */
export function createScrollNav({ root = document.querySelector('main'), selector = '[data-scroll-label]' } = {}) {
  if (!root?.id) throw new Error('Scroll navigation needs a root with an id.');
  const abort = new AbortController();
  const on = (target, type, fn, options = {}) => target.addEventListener(type, fn, { ...options, signal: abort.signal });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const heroWordmark = root.querySelector('.hero-wordmark');
  if (!heroWordmark) throw new Error('Scroll navigation needs a hero wordmark.');
  const bar = document.createElement('div');
  bar.className = 'scroll-ruler';
  Object.entries({ role: 'scrollbar', tabindex: '0', 'aria-controls': root.id, 'aria-orientation': 'vertical', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Page position' }).forEach(([k, v]) => bar.setAttribute(k, v));
  bar.innerHTML = '<div class="ruler-scale" aria-hidden="true"></div><div class="ruler-thumb" aria-hidden="true"></div><div class="ruler-position" aria-hidden="true"><span>000%</span></div>';
  const scale = bar.querySelector('.ruler-scale');
  const thumb = bar.querySelector('.ruler-thumb');
  const indicator = bar.querySelector('.ruler-position');
  for (let i = 0; i <= 100; i++) {
    const tick = document.createElement('div');
    tick.className = `ruler-tick${i % 5 === 0 ? ' major' : ''}`;
    tick.style.top = `${i}%`;
    if (i % 5 === 0) { const number = document.createElement('span'); number.textContent = i; tick.append(number); }
    scale.append(tick);
  }
  const overlay = document.createElement('nav');
  overlay.className = 'scroll-labels';
  overlay.setAttribute('aria-label', 'Jump to section');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Scroll navigation needs a 2D canvas context.');
  const ids = new Set();
  const sections = [...root.querySelectorAll(selector)].map((section, index) => {
    if (!section.id || ids.has(section.id)) throw new Error('Each scroll section needs a unique id.');
    ids.add(section.id);
    const label = section.dataset.scrollLabel;
    if (!label?.trim()) throw new Error('Each scroll section needs a non-empty label.');
    const interactive = !section.hasAttribute('data-scroll-static');
    const link = document.createElement(interactive ? 'a' : 'span');
    if (interactive) {
      link.href = `#${encodeURIComponent(section.id)}`;
      link.setAttribute('aria-label', `Jump to ${label}`);
    } else {
      link.setAttribute('aria-hidden', 'true');
    }
    link.className = interactive ? 'scroll-label-hit' : 'scroll-label-hit scroll-label-static';
    overlay.append(link);
    const letters = [...label].map(char => {
      const span = document.createElement('span');
      span.className = index === 0 ? 'scroll-letter scroll-letter-hero' : 'scroll-letter';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = char;
      overlay.append(span);
      return span;
    });
    if (interactive) {
      on(link, 'click', event => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        history.pushState(null, '', link.getAttribute('href'));
        section.scrollIntoView({ behavior: reduced.matches ? 'instant' : 'smooth', block: 'start' });
        // Keep keyboard navigation in the destination, not an off-screen section.
        if (!section.hasAttribute('tabindex')) {
          section.setAttribute('tabindex', '-1');
          section.addEventListener('blur', () => section.removeAttribute('tabindex'), { once: true, signal: abort.signal });
        }
        section.focus({ preventScroll: true });
      });
      on(link, 'pointerenter', () => letters.forEach(el => el.classList.add('hovered')));
      on(link, 'pointerleave', () => letters.forEach(el => el.classList.remove('hovered')));
    }
    return { section, link, letters, label, interactive, widths: [], textWidth: 0, top: 0 };
  });
  // Hide native scrollbar chrome, never native scrolling itself.
  const alreadyHidden = document.documentElement.classList.contains('scroll-nav-enabled');
  document.documentElement.classList.add('scroll-nav-enabled');
  // Text < thumb < ruler markings. The top visual layer never intercepts input.
  const readout = document.createElement('div');
  readout.className = 'ruler-readout';
  readout.setAttribute('aria-hidden', 'true');
  readout.append(scale, indicator);
  document.body.append(bar, overlay, thumb, readout);
  let frame = 0, measuring = true, documentHeight = 0, width = 0, height = 0;
  let heroOrigin;
  let pointerY = null, drag = null, jumpFrame = 0;
  function cancelTrackJump() {
    cancelAnimationFrame(jumpFrame);
    jumpFrame = 0;
  }
  function jumpTo(target) {
    cancelTrackJump();
    if (reduced.matches) {
      window.scrollTo({ top: target, behavior: 'instant' });
      return;
    }
    const from = scrollY;
    const distance = target - from;
    const duration = Math.min(850, 350 + Math.abs(distance) * .10) * .75;
    const start = performance.now();
    function tick(now) {
      const progress = clamp((now - start) / duration);
      const position = from + distance * easeOutScroll(progress);
      const done = progress >= 1 || Math.abs(target - position) <= 1;
      // Avoid spending extra frames creeping through fractional final pixels.
      window.scrollTo({ top: done ? target : Math.round(position), behavior: 'instant' });
      jumpFrame = done ? 0 : requestAnimationFrame(tick);
    }
    jumpFrame = requestAnimationFrame(tick);
  }
  // Any direct user input takes control back from the animated track jump.
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    on(window, type, cancelTrackJump, { capture: true, passive: true });
  }
  on(reduced, 'change', cancelTrackJump);
  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
  const measure = () => { measuring = true; schedule(); };
  function render() {
    frame = 0;
    if (measuring) {
      width = innerWidth; height = innerHeight;
      documentHeight = document.documentElement.scrollHeight;
      const wordmark = heroWordmark.getBoundingClientRect();
      heroOrigin = { x: wordmark.left + wordmark.width / 2, y: wordmark.top + scrollY + wordmark.height / 2, size: parseFloat(getComputedStyle(heroWordmark).fontSize) };
      for (const item of sections) {
        context.font = getComputedStyle(item.letters[0]).font;
        item.top = item.section.getBoundingClientRect().top + scrollY;
        item.widths = [...item.label].map(char => context.measureText(char).width);
        item.textWidth = item.widths.reduce((a, b) => a + b, 0);
      }
      scale.style.height = `${documentHeight}px`;
      measuring = false;
    }
    const g = rulerGeometry(scrollY, height, documentHeight);
    bar.hidden = thumb.hidden = readout.hidden = g.range === 0;
    bar.setAttribute('aria-valuenow', String(Math.round(g.progress * 100)));
    scale.style.transform = `translate3d(0,${g.offset}px,0)`;
    indicator.style.transform = `translate3d(0,${g.indicator}px,0)`;
    indicator.querySelector('span').textContent = `${String(Math.round(g.progress * 100)).padStart(3, '0')}%`;
    thumb.style.height = `${g.thumb}px`;
    thumb.style.transform = `translate3d(0,${60 + g.progress * (g.track - g.thumb)}px,0)`;
    for (let i = 0; i < scale.children.length; i++) {
      const tick = scale.children[i];
      const distance = pointerY === null ? Infinity : Math.abs(i / 100 * documentHeight + g.offset - pointerY);
      tick.style.scale = `${1 + .8 * Math.exp(-distance * distance / 5000)} 1`;
    }
    let activeIndex = 0;
    sections.forEach((item, index) => { if (item.top <= scrollY + 160) activeIndex = index; });
    if (g.range > 0 && g.progress === 1) activeIndex = sections.length - 1;
    sections.forEach((item, index) => {
      const options = { index, count: sections.length, top: item.top - scrollY, nextTop: (sections[index + 1]?.top ?? documentHeight + height) - scrollY, width, height, textWidth: item.textWidth, reduced: reduced.matches, heroOrigin, remainingScroll: Math.max(0, g.range - scrollY) };
      item.link.toggleAttribute('data-active', index === activeIndex);
      if (item.interactive && index === activeIndex) item.link.setAttribute('aria-current', 'location');
      else item.link.removeAttribute('aria-current');
      const letters = index === 0 ? heroLetterPoses(options, item.widths, scrollY) : letterPoses(options, item.widths);
      const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      item.letters.forEach((letter, i) => {
        const p = letters[i];
        const ratio = p.size / 34;
        letter.style.transform = `translate3d(${p.x}px,${p.y}px,0) translate(-50%,-50%) rotate(${p.angle}deg) scale(${ratio})`;
        letter.style.opacity = p.opacity;
        // The link must enclose the actual flying letters, not the word's old box.
        const radians = p.angle * Math.PI / 180;
        const cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians));
        const halfWidth = (item.widths[i] * ratio * cos + p.size * sin) / 2;
        const halfHeight = (item.widths[i] * ratio * sin + p.size * cos) / 2;
        bounds.left = Math.min(bounds.left, p.x - halfWidth);
        bounds.right = Math.max(bounds.right, p.x + halfWidth);
        bounds.top = Math.min(bounds.top, p.y - halfHeight);
        bounds.bottom = Math.max(bounds.bottom, p.y + halfHeight);
      });
      const hitWidth = Math.max(28, bounds.right - bounds.left + 12);
      const hitHeight = Math.max(24, bounds.bottom - bounds.top + 8);
      Object.assign(item.link.style, { left: `${(bounds.left + bounds.right - hitWidth) / 2}px`, top: `${(bounds.top + bounds.bottom - hitHeight) / 2}px`, width: `${hitWidth}px`, height: `${hitHeight}px` });
    });
  }
  on(window, 'scroll', schedule, { passive: true });
  on(window, 'resize', measure);
  on(reduced, 'change', schedule);
  const observer = new ResizeObserver(measure);
  observer.observe(root);
  observer.observe(document.body);
  document.fonts.ready.then(() => { if (!abort.signal.aborted) measure(); });
  const beginDrag = event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    const g = rulerGeometry(scrollY, height, documentHeight);
    const thumbTop = 60 + g.progress * (g.track - g.thumb);
    const inThumb = event.clientY >= thumbTop && event.clientY <= thumbTop + g.thumb;
    drag = { grab: inThumb ? event.clientY - thumbTop : g.thumb / 2, startY: event.clientY, moved: false };
    bar.setPointerCapture(event.pointerId);
    bar.classList.add('dragging');
    if (!inThumb) scrub(event.clientY, reduced.matches ? 'instant' : 'smooth');
  };
  on(bar, 'pointerdown', beginDrag);
  on(thumb, 'pointerdown', beginDrag);
  function scrub(y, behavior = 'instant') {
    const g = rulerGeometry(scrollY, height, documentHeight);
    const progress = clamp((y - 60 - drag.grab) / Math.max(1, g.track - g.thumb));
    const target = progress * g.range;
    if (behavior === 'smooth') jumpTo(target);
    else {
      cancelTrackJump();
      window.scrollTo({ top: target, behavior: 'instant' });
    }
  }
  const movePointer = event => {
    pointerY = event.clientY;
    if (drag) {
      // Ignore click jitter so it cannot cancel the smooth track jump.
      drag.moved ||= Math.abs(event.clientY - drag.startY) >= 3;
      if (drag.moved) scrub(event.clientY);
    }
    schedule();
  };
  for (const surface of [bar, thumb]) {
    on(surface, 'pointermove', movePointer);
    on(surface, 'pointerleave', () => { pointerY = null; schedule(); });
  }
  on(bar, 'lostpointercapture', () => { drag = null; bar.classList.remove('dragging'); });
  on(bar, 'keydown', event => {
    const range = Math.max(0, documentHeight - height);
    const destinations = { ArrowDown: scrollY + 80, ArrowUp: scrollY - 80, PageDown: scrollY + height * .9, PageUp: scrollY - height * .9, Home: 0, End: range, ' ': scrollY + height * .9 * (event.shiftKey ? -1 : 1) };
    if (!(event.key in destinations)) return;
    event.preventDefault();
    window.scrollTo({ top: clamp(destinations[event.key], 0, range), behavior: reduced.matches ? 'instant' : 'smooth' });
  });
  measure();
  return () => {
    cancelTrackJump();
    abort.abort(); observer.disconnect(); cancelAnimationFrame(frame); bar.remove(); overlay.remove(); thumb.remove(); readout.remove();
    if (!alreadyHidden) document.documentElement.classList.remove('scroll-nav-enabled');
  };
}
