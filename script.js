'use strict';
const body = document.querySelector('table tbody');
const allRows = [...body.rows];
let group = 'All';
let sortKey = 'Overall';
let descending = true;
const metricColumns = { TurnAcc: 2, EpiDepAcc: 3, AnsDepAcc: 4, Overall: 5 };
const search = document.querySelector('#model-search');
function updateResults() {
  const query = search.value.trim().toLowerCase();
  const sorted = [...allRows].sort((a, b) => {
    const column = metricColumns[sortKey];
    const diff = Number(a.cells[column].textContent) - Number(b.cells[column].textContent);
    return descending ? -diff : diff;
  });
  let models = 0;
  for (const row of sorted) {
    row.hidden = !(row.dataset.name.includes(query) && (group === 'All' || row.dataset.group === group));
    body.appendChild(row);
    if (!row.hidden) models++;
  }
  document.querySelector('#result-count').textContent = `${models} model${models === 1 ? '' : 's'}`;
  document.querySelector('#empty').hidden = models > 0;
}
for (const button of document.querySelectorAll('[data-filter]')) {
  button.addEventListener('click', () => {
    group = button.dataset.filter;
    for (const other of document.querySelectorAll('[data-filter]')) other.setAttribute('aria-pressed', String(other === button));
    updateResults();
  });
}
search.addEventListener('input', updateResults);
for (const button of document.querySelectorAll('[data-sort]')) {
  button.addEventListener('click', () => {
    descending = sortKey === button.dataset.sort ? !descending : true;
    sortKey = button.dataset.sort;
    for (const other of document.querySelectorAll('[data-sort]')) {
      const active = other === button;
      other.closest('th').removeAttribute('aria-sort');
      other.querySelector('span').textContent = active ? (descending ? '↓' : '↑') : '↕';
      if (active) other.closest('th').setAttribute('aria-sort', descending ? 'descending' : 'ascending');
    }
    updateResults();
  });
}
document.querySelector('#copy-citation').addEventListener('click', async event => {
  const button = event.currentTarget;
  const text = document.querySelector('#bibtex').textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied!';
    setTimeout(() => { button.textContent = 'Copy citation'; }, 1800);
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#bibtex'));
    selection.removeAllRanges();
    selection.addRange(range);
    button.textContent = 'Selected — press Ctrl/Cmd+C';
  }
});

// Keep the decorative filmstrip optional and stop it while it is out of view.
const heroStage = document.querySelector('.hero-stage');
const motionToggle = document.querySelector('#motion-toggle');
if (heroStage && motionToggle) {
  const staticBackground = window.matchMedia('(prefers-reduced-motion: reduce), (max-width: 600px)');
  let userPaused = false;
  let heroVisible = true;

  function syncBackgroundMotion() {
    heroStage.dataset.paused = String(userPaused || staticBackground.matches);
    heroStage.dataset.offscreen = String(!heroVisible || document.hidden);
    motionToggle.hidden = staticBackground.matches;
    motionToggle.setAttribute('aria-pressed', String(userPaused));
    motionToggle.querySelector('span').textContent = userPaused ? 'Play background' : 'Pause background';
  }

  motionToggle.addEventListener('click', () => {
    userPaused = !userPaused;
    syncBackgroundMotion();
  });
  staticBackground.addEventListener('change', syncBackgroundMotion);
  document.addEventListener('visibilitychange', syncBackgroundMotion);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      heroVisible = entries[0].isIntersecting;
      syncBackgroundMotion();
    }).observe(heroStage);
  }
  syncBackgroundMotion();
}
