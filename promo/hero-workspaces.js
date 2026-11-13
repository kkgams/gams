const wall = document.querySelector('.hero-wall');
const preview = document.querySelector('.hero-preview');
if (!wall || !preview) throw new Error('Workspace gallery needs its wall and preview dialog.');
const workspaces = [...wall.querySelectorAll('a.hero-workspace')];
if (workspaces.length !== 4) throw new Error('Workspace gallery needs four source images.');
const image = preview.querySelector('.hero-preview-image');
const title = preview.querySelector('.hero-preview-title');
const count = preview.querySelector('.hero-preview-count');
const fullSize = preview.querySelector('.hero-preview-link');
const close = preview.querySelector('.hero-preview-close');
const previous = preview.querySelector('.hero-preview-prev');
const next = preview.querySelector('.hero-preview-next');
if (!image || !title || !count || !fullSize || !close || !previous || !next) throw new Error('Workspace preview is incomplete.');
const mobile = matchMedia('(max-width: 860px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
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

function showWorkspace(index) {
  selected = (index + workspaces.length) % workspaces.length;
  const workspace = workspaces[selected];
  image.src = workspace.href;
  image.alt = workspace.querySelector('img').alt;
  title.textContent = workspace.dataset.title;
  count.textContent = `${selected + 1} / ${workspaces.length}`;
  fullSize.href = workspace.href;
}

wall.addEventListener('click', event => {
  const link = event.target.closest('a.hero-workspace');
  if (!link || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  showWorkspace(Number(link.dataset.workspace));
  preview.showModal();
  close.focus();
});
close.addEventListener('click', () => preview.close());
previous.addEventListener('click', () => showWorkspace(selected - 1));
next.addEventListener('click', () => showWorkspace(selected + 1));
image.addEventListener('click', () => preview.close());
preview.addEventListener('click', event => { if (event.target === preview) preview.close(); });
preview.addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  showWorkspace(selected + (event.key === 'ArrowLeft' ? -1 : 1));
});
window.addEventListener('resize', renderWall);
reduced.addEventListener('change', renderWall);
renderWall();
