const wall = document.querySelector('.hero-wall');
const units = document.querySelector('.unit-grid');
const preview = document.querySelector('.hero-preview');
if (!wall || !units || !preview) throw new Error('Promo previews need the hero wall, Unit grid, and dialog.');
const workspaces = [...wall.querySelectorAll('a.hero-workspace')];
if (workspaces.length !== 4) throw new Error('Workspace gallery needs four source images.');
const unitArt = [...units.querySelectorAll('button.unit-art')];
const art = preview.querySelector('.hero-preview-art');
const image = preview.querySelector('.hero-preview-image');
const title = preview.querySelector('.hero-preview-title');
const count = preview.querySelector('.hero-preview-count');
const fullSize = preview.querySelector('.hero-preview-link');
const linkLabel = fullSize?.querySelector('span');
const close = preview.querySelector('.hero-preview-close');
const previous = preview.querySelector('.hero-preview-prev');
const next = preview.querySelector('.hero-preview-next');
if (!art || !image || !title || !count || !fullSize || !linkLabel || !close || !previous || !next) throw new Error('Workspace preview is incomplete.');
const mobile = matchMedia('(max-width: 860px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let gallery = workspaces;
let selected = 0;

function renderWall() {
  const columns = reduced.matches ? 2 : mobile.matches ? 3 : 4;
  wall.toggleAttribute('data-animated', !reduced.matches);
  const style = getComputedStyle(wall);
  const tileWidth = (wall.clientWidth - parseFloat(style.columnGap) * (columns - 1)) / columns;
  const rowHeight = tileWidth * 10 / 16 + parseFloat(style.getPropertyValue('--hero-gap'));
  // Cover the entire tilted viewport throughout a cycle, including tall screens.
  const tilesPerSequence = reduced.matches ? 2 : Math.max(8, Math.ceil((wall.clientHeight / rowHeight + 2) / 4) * 4);
  wall.style.setProperty('--hero-cycle-scale', String(tilesPerSequence / 6));
  const fragment = document.createDocumentFragment();
  for (let columnIndex = 0; columnIndex < columns; columnIndex++) {
    const column = document.createElement('div');
    column.className = 'hero-column';
    for (let repeat = 0; repeat < (reduced.matches ? 1 : 2); repeat++) {
      const sequence = document.createElement('div');
      sequence.className = 'hero-sequence';
      for (let tile = 0; tile < tilesPerSequence; tile++) {
        const index = (reduced.matches ? columnIndex * 2 + tile : columnIndex + tile) % workspaces.length;
        const original = reduced.matches || (columnIndex === Math.floor(columns / 2) && repeat === 0 && tile < 4);
        const link = original ? workspaces[index] : workspaces[index].cloneNode(true);
        link.dataset.workspace = String(index);
        if (!original) {
          link.tabIndex = -1;
          link.setAttribute('aria-hidden', 'true');
          const thumbnail = link.querySelector('img');
          thumbnail.alt = '';
          thumbnail.removeAttribute('fetchpriority');
        }
        sequence.append(link);
      }
      column.append(sequence);
    }
    fragment.append(column);
  }
  wall.replaceChildren(fragment);
}

function showPreview(index) {
  selected = (index + gallery.length) % gallery.length;
  const item = gallery[selected];
  const isUnit = gallery === unitArt;
  const type = isUnit ? 'Unit' : 'workspace';
  preview.setAttribute('aria-label', `${type} preview`);
  close.setAttribute('aria-label', `Close ${type} preview`);
  previous.setAttribute('aria-label', `Previous ${type}`);
  next.setAttribute('aria-label', `Next ${type}`);
  count.textContent = `${selected + 1} / ${gallery.length}`;
  image.hidden = isUnit;
  art.hidden = !isUnit;
  if (isUnit) {
    const card = item.closest('.unit-card');
    title.textContent = card.querySelector('h3').textContent;
    art.replaceChildren(item.querySelector('svg').cloneNode(true));
    const launch = card.querySelector('.unit-actions a[href^="/app.html"]');
    fullSize.hidden = !launch;
    if (launch) {
      fullSize.href = launch.href;
      linkLabel.textContent = 'Launch in GAMS';
    } else {
      fullSize.removeAttribute('href');
    }
  } else {
    image.src = item.href;
    image.alt = item.querySelector('img').alt;
    title.textContent = item.dataset.title;
    fullSize.href = item.href;
    linkLabel.textContent = 'Open full-size image';
    fullSize.hidden = false;
  }
}

function openPreview(items, index) {
  gallery = items;
  showPreview(index);
  preview.showModal();
  close.focus();
}

wall.addEventListener('click', event => {
  const link = event.target.closest('a.hero-workspace');
  if (!link || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  openPreview(workspaces, Number(link.dataset.workspace));
});
unitArt.forEach((button, index) => button.addEventListener('click', () => openPreview(unitArt, index)));
close.addEventListener('click', () => preview.close());
previous.addEventListener('click', () => showPreview(selected - 1));
next.addEventListener('click', () => showPreview(selected + 1));
preview.addEventListener('click', event => {
  if (event.target === preview || event.target === image || art.contains(event.target)) preview.close();
});
preview.addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  showPreview(selected + (event.key === 'ArrowLeft' ? -1 : 1));
});
window.addEventListener('resize', renderWall);
reduced.addEventListener('change', renderWall);
renderWall();
