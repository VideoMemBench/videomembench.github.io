'use strict';

(() => {
  const section = document.querySelector('#case-study');
  if (!section) return;

  const player = section.querySelector('.case-player');
  const scroller = section.querySelector('#case-questions');
  const list = section.querySelector('.case-question-list');
  const toggle = section.querySelector('#case-toggle');
  const previous = section.querySelector('#case-previous');
  const next = section.querySelector('#case-next');
  const navigation = section.querySelector('.case-turn-nav');
  const caseButtons = [...section.querySelectorAll('[data-case-id]')];
  const position = section.querySelector('#case-position');
  const time = section.querySelector('#case-time');
  const label = section.querySelector('.case-video-label');
  const excerptLabel = section.querySelector('#case-excerpt-label');
  const sourceNote = section.querySelector('.case-source-note');
  const status = section.querySelector('#case-media-status');
  const statusText = section.querySelector('#case-status-text');
  const retry = section.querySelector('#case-retry');
  const sourceFallback = section.querySelector('#case-source-fallback');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const caseIds = new Set(caseButtons.map(button => button.dataset.caseId));
  const cache = new Map();
  // The share package embeds annotations so a file:// preview does not need
  // a JSON fetch. Keep the fetch path for pages without the embedded bundle.
  let bundledCases = {};
  try {
    const bundle = document.querySelector('#case-data');
    if (bundle) bundledCases = JSON.parse(bundle.textContent);
  } catch (error) {
    console.warn('Could not read bundled case annotations.', error);
  }

  let video = null;
  let selectedCase = '';
  let caseRequest = 0;
  let fetchController = null;
  let playRequest = 0;
  let turns = [];
  let groups = [];
  let segments = [];
  let activeTurn = null;
  let activeGroup = null;
  let manualSelection = false;
  let wantsPlayback = false;
  let visible = false;
  let loading = false;
  let mediaFailed = false;
  let finished = false;
  let pendingSeek = null;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const formatTime = seconds => {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  };
  const shouldPlay = () => !!video && wantsPlayback && visible && !document.hidden
    && !loading && !mediaFailed && !finished;
  const safeSourceURL = value => {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  };

  function refreshVisibility() {
    // IntersectionObserver notifications can lag behind a resize or scroll.
    // Read the current geometry before acting on a Play click or new video.
    const rect = player.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    visible = rect.width > 0 && rect.height > 0
      && width * height / (rect.width * rect.height) >= 0.15;
  }

  function originalTime(playbackTime) {
    if (!segments.length) return playbackTime;
    let segment = segments[0];
    for (const candidate of segments) {
      if (candidate.playback_start > playbackTime) break;
      segment = candidate;
    }
    return segment.source_start + Math.min(
      Math.max(0, playbackTime - segment.playback_start),
      segment.source_end - segment.source_start,
    );
  }

  function mapWindow(window) {
    const start = Number(window.start_seconds);
    const end = Number(window.end_seconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
    if (!segments.length) return [{ start, end }];
    return segments.flatMap(segment => {
      const from = Math.max(start, segment.source_start);
      const to = Math.min(end, segment.source_end);
      if (to <= from) return [];
      return [{
        start: segment.playback_start + from - segment.source_start,
        end: segment.playback_start + to - segment.source_start,
      }];
    });
  }

  function updateTime() {
    time.textContent = formatTime(originalTime(pendingSeek ?? video?.currentTime ?? 0));
  }

  function updateControl() {
    const playing = shouldPlay();
    toggle.setAttribute('aria-pressed', String(playing));
    toggle.querySelector('span:first-child').textContent = playing ? 'Ⅱ' : finished ? '↻' : '▶';
    toggle.querySelector('span:last-child').textContent = loading ? 'Loading case'
      : playing ? 'Pause case' : finished ? 'Replay case' : 'Play case';
    toggle.disabled = loading || mediaFailed || !video;
    const index = activeTurn ? activeTurn.index : -1;
    previous.disabled = loading || index <= 0;
    next.disabled = loading || index < 0 || index >= turns.length - 1;
  }

  function renderSelection(group, turn, scroll = true) {
    if (!turn) return;
    activeGroup = group;
    activeTurn = turn;
    const shown = manualSelection || !group ? [turn] : group.turns;
    turns.forEach(item => {
      [item.card, item.button].forEach(node => {
        node.classList.toggle('is-active', shown.includes(item));
        if (item === turn) node.setAttribute('aria-current', 'step');
        else node.removeAttribute('aria-current');
      });
    });
    const numbers = shown.map(item => item.index + 1);
    const consecutive = numbers.every((number, index) => !index || number === numbers[index - 1] + 1);
    position.textContent = shown.length > 1
      ? `Turns ${consecutive ? `${numbers[0]}–${numbers[numbers.length - 1]}` : numbers.join(', ')} / ${turns.length}`
      : `Turn ${turn.index + 1} / ${turns.length}`;
    updateControl();
    if (scroll) {
      const top = turn.card.getBoundingClientRect().top
        - scroller.getBoundingClientRect().top + scroller.scrollTop;
      scroller.scrollTo({ top: Math.max(0, top), behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  }

  function syncQuestions(scroll = true, refresh = false) {
    updateTime();
    if (!video || loading || manualSelection || !groups.length) return;
    // Between evidence windows, keep the latest questions readable. This never
    // changes the media position; source-time gaps are already cut in the file.
    const currentTime = pendingSeek ?? video.currentTime;
    let group = groups[0];
    for (const candidate of groups) {
      if (candidate.start > currentTime) break;
      group = candidate;
    }
    if (group !== activeGroup || refresh) {
      const turn = group.turns.includes(activeTurn) ? activeTurn : group.turns[0];
      renderSelection(group, turn, scroll);
    }
  }

  // Only an explicit question selection or Replay can seek.
  function seekTo(seconds) {
    pendingSeek = seconds;
    if (video?.readyState >= 1 && !mediaFailed) {
      video.currentTime = seconds;
      pendingSeek = null;
    }
    updateTime();
  }

  function syncPlayback() {
    refreshVisibility();
    const request = ++playRequest;
    const currentVideo = video;
    updateControl();
    if (!currentVideo) return;
    if (!shouldPlay()) {
      currentVideo.pause();
      return;
    }
    currentVideo.play().then(() => {
      if (request !== playRequest || currentVideo !== video) return;
      if (!shouldPlay()) currentVideo.pause();
      updateControl();
    }).catch(error => {
      if (request !== playRequest || currentVideo !== video || error.name === 'AbortError') return;
      if (error.name === 'NotSupportedError') {
        showUnavailable('Video unavailable. You can still read the questions below.');
        return;
      }
      wantsPlayback = false;
      updateControl();
    });
  }

  function selectTurn(index) {
    const turn = turns[index];
    if (!turn || loading) return;
    wantsPlayback = false;
    manualSelection = true;
    finished = false;
    syncPlayback();
    const currentWindow = turn.windows.find(window =>
      video && video.currentTime >= window.start && video.currentTime < window.end);
    const targetWindow = currentWindow || turn.windows[0];
    const group = targetWindow ? groups.find(item => item.start === targetWindow.start) : null;
    renderSelection(group, turn);
    if (targetWindow && (!currentWindow || video?.readyState < 1)) {
      seekTo(targetWindow.start);
    } else {
      pendingSeek = null;
      updateTime();
    }
  }

  function pauseForReading() {
    if (!wantsPlayback) return;
    wantsPlayback = false;
    syncPlayback();
  }

  function showUnavailable(message) {
    mediaFailed = true;
    wantsPlayback = false;
    status.hidden = false;
    statusText.textContent = message;
    retry.hidden = false;
    syncPlayback();
  }

  function turnButton(turn, className, accessibleLabel) {
    const button = element('button', className, turn.id);
    button.type = 'button';
    button.dataset.caseTurn = String(turn.index);
    button.setAttribute('aria-label', accessibleLabel);
    return button;
  }

  function renderQuestions(data) {
    const windows = new Map();
    turns = data.turns.map((record, index) => {
      const evidence = Array.isArray(record.evidence_windows) ? record.evidence_windows : [];
      const turn = {
        id: String(record.id),
        index,
        windows: evidence.flatMap(mapWindow).sort((a, b) => a.start - b.start),
        record,
      };
      const card = element('li', 'case-question-card');
      card.id = `case-${selectedCase}-${turn.id.toLowerCase()}`;
      const meta = element('div', 'case-question-meta');
      meta.append(turnButton(turn, 'case-turn-trigger', `View question ${index + 1}`));
      meta.append(element('span', 'case-timestamp', evidence.map(window =>
        `${formatTime(window.start_seconds)}–${formatTime(window.end_seconds)}`).join(' · ')));
      card.append(meta, element('p', 'case-question', record.question));
      if (record.options && typeof record.options === 'object') {
        const details = element('details', 'case-options');
        details.append(element('summary', '', 'Answer choices'));
        const options = element('ol');
        Object.entries(record.options).forEach(([key, value]) => {
          const item = element('li');
          item.append(element('strong', '', `${key}.`), document.createTextNode(` ${value}`));
          options.append(item);
        });
        details.append(options);
        details.addEventListener('toggle', () => { if (details.open) pauseForReading(); });
        card.append(details);
      }
      const answer = element('p', 'case-answer');
      const answerText = record.answer_text ?? record.answer;
      const answerPrefix = record.options && Object.prototype.hasOwnProperty.call(record.options, record.answer)
        ? `${record.answer}. ` : '';
      answer.append(element('span', '', 'Answer.'), document.createTextNode(answerPrefix + answerText));
      card.append(answer);
      const parents = record.dependency?.depends_on || [];
      if (parents.length) {
        const dependencies = element('div', 'case-dependencies');
        dependencies.append(element('span', '', 'Refers to'));
        parents.forEach(id => {
          const parentIndex = data.turns.findIndex(item => item.id === id);
          const type = record.dependency?.dep_type?.[id];
          const text = type ? `${id} (${type})` : id;
          if (parentIndex < 0) {
            dependencies.append(element('span', '', text));
            return;
          }
          const button = element('button', 'case-parent', text);
          button.type = 'button';
          button.dataset.caseTurn = String(parentIndex);
          button.setAttribute('aria-label', `Revisit ${id}${type ? `, ${type} dependency` : ''}`);
          dependencies.append(button);
        });
        card.append(dependencies);
      }
      turn.card = card;
      turn.button = turnButton(turn, '', `View turn ${index + 1}`);
      turn.windows.forEach(window => {
        if (!windows.has(window.start)) windows.set(window.start, { start: window.start, turns: [] });
        const group = windows.get(window.start);
        if (!group.turns.includes(turn)) group.turns.push(turn);
      });
      return turn;
    });
    groups = [...windows.values()].sort((a, b) => a.start - b.start);
    navigation.style.setProperty('--case-turn-count', String(turns.length));
    navigation.replaceChildren(...turns.map(turn => turn.button));
    list.replaceChildren(...turns.map(turn => turn.card));
    scroller.scrollTo({ top: 0, behavior: 'instant' });
    activeGroup = groups[0] || null;
    activeTurn = activeGroup?.turns[0] || turns[0];
    renderSelection(activeGroup, activeTurn, false);
  }

  function renderSource(data, id) {
    const sourceURL = safeSourceURL(data.source_url || data.provenance?.source_video?.url
      || (id === 'basketball' ? 'https://www.youtube.com/watch?v=DBM1MPOl6pA' : ''));
    sourceFallback.hidden = !sourceURL;
    if (sourceURL) sourceFallback.href = sourceURL;
    else sourceFallback.removeAttribute('href');
    const note = data.source_note || 'Original questions, reference answers, evidence windows, and dependencies are preserved.';
    sourceNote.replaceChildren(document.createTextNode(`${note} Question numbers follow the original dialogue order. `));
    const annotations = element('a', '', 'Case annotations ↓');
    annotations.href = `assets/case-study/${id}-case.json`;
    annotations.download = '';
    sourceNote.append(annotations);
    if (sourceURL) {
      const link = element('a', '', 'Source video ↗');
      link.href = sourceURL;
      link.target = '_blank';
      link.rel = 'noopener';
      sourceNote.append(document.createTextNode(' · '), link);
    }
  }

  async function loadCase(id, reload = false) {
    if (!caseIds.has(id) || (id === selectedCase && !reload)) return;
    const request = ++caseRequest;
    ++playRequest;
    fetchController?.abort();
    fetchController = new AbortController();
    const signal = fetchController.signal;
    selectedCase = id;
    loading = true;
    mediaFailed = false;
    finished = false;
    manualSelection = false;
    pendingSeek = null;
    wantsPlayback = !reducedMotion.matches;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    video = null;
    turns = [];
    groups = [];
    segments = [];
    activeTurn = null;
    activeGroup = null;
    section.setAttribute('aria-busy', 'true');
    caseButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.caseId === id)));
    player.replaceChildren(element('span', 'case-loading', 'Loading video…'));
    list.replaceChildren(element('li', 'case-loading-questions', 'Loading questions…'));
    navigation.replaceChildren();
    label.textContent = caseButtons.find(button => button.dataset.caseId === id).textContent;
    excerptLabel.hidden = true;
    position.textContent = '';
    time.textContent = '00:00';
    sourceNote.replaceChildren();
    status.hidden = true;
    retry.hidden = true;
    sourceFallback.hidden = true;
    updateControl();
    try {
      let data = (!reload && cache.get(id)) || bundledCases[id];
      if (!data) {
        const response = await fetch(`assets/case-study/${id}-case.json`, { signal });
        if (!response.ok) throw new Error(`Case annotations unavailable (${response.status})`);
        data = await response.json();
      }
      if (!Array.isArray(data.turns) || !data.turns.length) throw new Error('No case questions');
      cache.set(id, data);
      if (request !== caseRequest) return;
      segments = (data.playback_segments || []).map(segment => ({
        source_start: Number(segment.source_start),
        source_end: Number(segment.source_end),
        playback_start: Number(segment.playback_start),
      })).filter(segment => Number.isFinite(segment.source_start) && Number.isFinite(segment.source_end)
        && Number.isFinite(segment.playback_start) && segment.source_end > segment.source_start)
        .sort((a, b) => a.playback_start - b.playback_start);
      label.textContent = data.display_title || data.title || id;
      excerptLabel.hidden = !segments.length;
      excerptLabel.textContent = 'Selected excerpts · original video time';
      renderSource(data, id);
      renderQuestions(data);

      const currentVideo = element('video');
      currentVideo.id = 'case-video';
      currentVideo.muted = true;
      currentVideo.defaultMuted = true;
      currentVideo.playsInline = true;
      currentVideo.preload = 'metadata';
      currentVideo.poster = `assets/case-study/${id}-poster.webp`;
      currentVideo.setAttribute('aria-label', `${data.display_title || data.title}: case video`);
      const isCurrent = () => request === caseRequest && currentVideo === video;
      currentVideo.addEventListener('loadedmetadata', () => {
        if (!isCurrent()) return;
        mediaFailed = false;
        status.hidden = true;
        if (pendingSeek !== null) seekTo(pendingSeek);
        syncQuestions(false);
        syncPlayback();
      });
      currentVideo.addEventListener('timeupdate', () => { if (isCurrent()) syncQuestions(); });
      currentVideo.addEventListener('seeked', () => { if (isCurrent()) syncQuestions(); });
      currentVideo.addEventListener('ended', () => {
        if (!isCurrent()) return;
        finished = true;
        wantsPlayback = false;
        syncQuestions(false);
        syncPlayback();
      });
      currentVideo.addEventListener('error', () => {
        if (isCurrent()) showUnavailable('Video unavailable. You can still read the questions below.');
      });
      video = currentVideo;
      player.replaceChildren(currentVideo);
      loading = false;
      section.removeAttribute('aria-busy');
      currentVideo.src = `assets/case-study/${id}.mp4`;
      currentVideo.load();
      syncQuestions(false);
      syncPlayback();
    } catch (error) {
      if (request !== caseRequest || error.name === 'AbortError') return;
      console.error(`Could not load case ${id}.`, error);
      loading = false;
      section.removeAttribute('aria-busy');
      player.replaceChildren(element('span', 'case-loading', 'Case unavailable'));
      list.replaceChildren(element('li', 'case-loading-questions', 'Questions could not be loaded.'));
      showUnavailable('This case could not be loaded. Please try again.');
    }
  }

  toggle.addEventListener('click', () => {
    if (!video || loading || mediaFailed) return;
    refreshVisibility();
    if (finished || video.ended) {
      finished = false;
      manualSelection = false;
      seekTo(0);
      wantsPlayback = true;
      syncQuestions(true, true);
    } else if (shouldPlay() && !video.paused) {
      wantsPlayback = false;
    } else {
      manualSelection = false;
      wantsPlayback = true;
      syncQuestions(false, true);
    }
    syncPlayback();
  });
  section.addEventListener('click', event => {
    const button = event.target.closest('[data-case-turn]');
    if (button && section.contains(button)) selectTurn(Number(button.dataset.caseTurn));
  });
  caseButtons.forEach(button => button.addEventListener('click', () => loadCase(button.dataset.caseId)));
  retry.addEventListener('click', () => loadCase(selectedCase, true));
  previous.addEventListener('click', () => selectTurn(Math.max(0, (activeTurn?.index ?? 0) - 1)));
  next.addEventListener('click', () => selectTurn(Math.min(turns.length - 1, (activeTurn?.index ?? 0) + 1)));
  scroller.addEventListener('wheel', pauseForReading, { passive: true });
  scroller.addEventListener('pointerdown', pauseForReading, { passive: true });
  scroller.addEventListener('focusin', pauseForReading);
  scroller.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) pauseForReading();
  });
  document.addEventListener('visibilitychange', syncPlayback);
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) wantsPlayback = false;
    syncPlayback();
  });
  new IntersectionObserver(() => {
    syncPlayback();
  }, { threshold: [0, 0.15] }).observe(player);

  loadCase('basketball');
})();
