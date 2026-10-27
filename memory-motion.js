'use strict';

(() => {
  const images = [...document.querySelectorAll('.memory-story .diagram-figure > img')];
  if (!images.length) return;

  const svgNS = 'http://www.w3.org/2000/svg';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const diagrams = [];
  let frameRequest = 0;
  let previousTime = 0;

  const clamp = value => Math.max(0, Math.min(1, value));
  const ease = value => value * value * (3 - 2 * value);
  const range = value => value.split(',').map(Number);
  const phase = (progress, [start, end]) => ease(clamp((progress - start) / (end - start)));

  function scrollProgress(figure) {
    const height = window.innerHeight;
    // Finish while the whole diagram is still comfortably in view.
    return clamp((height * .85 - figure.getBoundingClientRect().top) / (height * .55));
  }

  function paint(diagram, progress) {
    for (const item of diagram.reveals) {
      const amount = phase(progress, item.range);
      item.node.style.opacity = amount.toFixed(4);
      item.node.style.transform = `translateY(${((1 - amount) * 10).toFixed(2)}px)`;
    }
    for (const item of diagram.lines) {
      const amount = phase(progress, item.range);
      item.maskPath.style.strokeDashoffset = String(item.length * (1 - amount));
      item.node.style.opacity = amount === 0 ? '0' : '1';
    }
    diagram.svg.dataset.motionComplete = String(progress === 1);
  }

  function animate(now) {
    frameRequest = 0;
    if (document.hidden) {
      previousTime = 0;
      return;
    }
    const elapsed = previousTime ? Math.min(64, now - previousTime) : 16;
    previousTime = now;
    let unsettled = false;

    // Read layout together, then update SVG properties without moving page layout.
    for (const diagram of diagrams) {
      diagram.target = reducedMotion.matches ? 1 : scrollProgress(diagram.figure);
    }
    for (const diagram of diagrams) {
      const difference = diagram.target - diagram.progress;
      if (reducedMotion.matches || Math.abs(difference) < .001) {
        diagram.progress = diagram.target;
      } else {
        diagram.progress += difference * (1 - Math.exp(-elapsed / 75));
        unsettled = true;
      }
      paint(diagram, diagram.progress);
    }
    if (unsettled) frameRequest = requestAnimationFrame(animate);
    else previousTime = 0;
  }

  function refresh() {
    if (!frameRequest) frameRequest = requestAnimationFrame(animate);
  }

  async function enhance(image, index) {
    try {
      // Keep the complete static image until its animated replacement is ready.
      const response = await fetch(image.currentSrc || image.src);
      if (!response.ok) return;
      const parsed = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
      if (parsed.querySelector('parsererror')) return;
      const source = parsed.documentElement;
      if (source.localName !== 'svg') return;
      const svg = document.importNode(source, true);
      const figure = image.closest('figure');
      const reveals = [...svg.querySelectorAll('[data-reveal]')].map(node => ({
        node, range: range(node.dataset.reveal),
      }));
      const lineNodes = [...svg.querySelectorAll('[data-draw]')];
      if (!reveals.length) return;

      svg.classList.add('memory-diagram');
      svg.setAttribute('focusable', 'false');
      const defs = svg.querySelector('defs');
      const lines = lineNodes.map((node, lineIndex) => {
        // Reveal the original stroke through a mask, preserving episodic dashes.
        const id = `memory-ink-${index}-${lineIndex}`;
        const mask = document.createElementNS(svgNS, 'mask');
        mask.id = id;
        mask.setAttribute('maskUnits', 'userSpaceOnUse');
        mask.setAttribute('x', '0');
        mask.setAttribute('y', '0');
        mask.setAttribute('width', '640');
        mask.setAttribute('height', '400');
        const maskPath = document.createElementNS(svgNS, 'path');
        maskPath.setAttribute('d', node.getAttribute('d'));
        maskPath.setAttribute('fill', 'none');
        maskPath.setAttribute('stroke', 'white');
        maskPath.setAttribute('stroke-width', '18');
        maskPath.setAttribute('stroke-linecap', 'round');
        const length = maskPath.getTotalLength();
        maskPath.style.strokeDasharray = `${length} ${length}`;
        mask.append(maskPath);
        defs.append(mask);
        node.setAttribute('mask', `url(#${id})`);
        return { node, maskPath, length, range: range(node.dataset.draw) };
      });
      const progress = reducedMotion.matches ? 1 : scrollProgress(figure);
      const diagram = { svg, figure, reveals, lines, progress, target: progress };
      paint(diagram, progress);
      image.replaceWith(svg);
      diagrams.push(diagram);
      refresh();
    } catch {
      // A blocked or unavailable SVG leaves the original readable image intact.
    }
  }

  window.addEventListener('scroll', refresh, { passive: true });
  window.addEventListener('resize', refresh, { passive: true });
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', refresh);
  reducedMotion.addEventListener('change', refresh);
  images.forEach(enhance);
})();
