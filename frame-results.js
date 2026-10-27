'use strict';

(() => {
  const section = document.querySelector('#frame-results');
  if (!section) return;

  const tabList = section.querySelector('.frame-tabs');
  const tabs = [...section.querySelectorAll('[data-frame-tab]')];
  const panels = [...section.querySelectorAll('[data-frame-budget]')];
  const status = section.querySelector('#frame-results-status');
  const columns = { TurnAcc: 2, EpiDepAcc: 3, AnsDepAcc: 4, Overall: 5 };
  const tables = panels.map(panel => ({
    panel,
    body: panel.querySelector('tbody'),
    rows: [...panel.querySelector('tbody').rows],
    headers: [...panel.querySelectorAll('[data-frame-metric]')],
  }));
  if (!tabs.length || !tables.length) return;

  let budget = 64;
  let sortKey = 'Overall';
  let descending = true;

  function sortTables() {
    tables.forEach(({ body, rows, headers }) => {
      const sorted = rows.map((row, index) => ({ row, index })).sort((a, b) => {
        const difference = Number(a.row.cells[columns[sortKey]].textContent)
          - Number(b.row.cells[columns[sortKey]].textContent);
        return (descending ? -difference : difference) || a.index - b.index;
      });
      body.append(...sorted.map(item => item.row));
      headers.forEach(header => {
        const active = header.dataset.frameMetric === sortKey;
        if (active) header.setAttribute('aria-sort', descending ? 'descending' : 'ascending');
        else header.removeAttribute('aria-sort');
        header.querySelector('.frame-sort-direction').textContent =
          active ? descending ? '↓' : '↑' : '↕';
      });
    });
  }

  function announce() {
    const count = tables.find(table => Number(table.panel.dataset.frameBudget) === budget).rows.length;
    status.textContent = `${budget} frames. ${count} open-weight models. Sorted by ${sortKey}, ${descending ? 'highest first' : 'lowest first'}.`;
  }

  function selectBudget(value, focus = false) {
    budget = value;
    tabs.forEach(tab => {
      const selected = Number(tab.dataset.frameTab) === budget;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    panels.forEach(panel => { panel.hidden = Number(panel.dataset.frameBudget) !== budget; });
    announce();
  }

  tables.forEach(({ panel, headers }) => {
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `frame-tab-${panel.dataset.frameBudget}`);
    headers.forEach(header => {
      const label = header.querySelector('.frame-metric-label');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.frameSort = header.dataset.frameMetric;
      button.append(document.createTextNode(label.textContent + ' '));
      const direction = document.createElement('span');
      direction.className = 'frame-sort-direction';
      direction.setAttribute('aria-hidden', 'true');
      button.append(direction);
      label.replaceWith(button);
      button.addEventListener('click', () => {
        descending = sortKey === button.dataset.frameSort ? !descending : true;
        sortKey = button.dataset.frameSort;
        sortTables();
        announce();
      });
    });
  });

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectBudget(Number(tab.dataset.frameTab)));
    tab.addEventListener('keydown', event => {
      let target;
      if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') target = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = tabs.length - 1;
      else return;
      event.preventDefault();
      selectBudget(Number(tabs[target].dataset.frameTab), true);
    });
  });

  sortTables();
  selectBudget(budget);
  section.dataset.enhanced = 'true';
  tabList.hidden = false;
})();
