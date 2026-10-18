/**
 * Watches the guide (left menu) and, while it is open, shrinks the page to
 * fit beside it (guide-fit.css). Measured, not hard-coded, so a YouTube
 * update that changes the guide's width still fits.
 */
import './guide-fit.css';
import { fitBesideGuide } from './core';

const GAP = 12;
// On <html>, as an attribute: YouTube rewrites body.className on every navigation.
const OPEN_ATTRIBUTE = 'data-ytaf-guide-open';

/** The measured fit, in a style element of ours: YouTube rewrites html's style attribute. */
const fitStyle = document.createElement('style');

/** The collapsed guide is as wide as the page's left inset; 156 on webOS. */
let collapsedWidth = 156;
let wasOpen = false;

/** The guide's background reaches past its own box; take the widest child. */
function rightEdge(guide: Element) {
  let right = guide.getBoundingClientRect().right;
  for (const child of Array.from(guide.children)) {
    right = Math.max(right, child.getBoundingClientRect().right);
  }
  return right;
}

function update(guide: Element) {
  const width = guide.getBoundingClientRect().width;
  const open = width > collapsedWidth * 1.5;
  const root = document.documentElement;
  if (open) {
    const { shift, scale } = fitBesideGuide(
      window.innerWidth,
      collapsedWidth,
      rightEdge(guide),
      GAP
    );
    const vars = `html { --ytaf-guide-shift: ${shift}px; --ytaf-guide-scale: ${scale}; }`;
    if (fitStyle.textContent !== vars) fitStyle.textContent = vars;
    if (!fitStyle.isConnected) document.head.appendChild(fitStyle);
    root.setAttribute(OPEN_ATTRIBUTE, '');
  } else {
    if (width > 0) collapsedWidth = width;
    root.removeAttribute(OPEN_ATTRIBUTE);
  }
  if (open !== wasOpen) {
    wasOpen = open;
    // Lets YouTube's lists re-measure, so the rows fill the taller page.
    window.dispatchEvent(new Event('resize'));
  }
}

let watched: Element | null = null;

/**
 * The guide appears after start-up and can be re-created; keep watching,
 * and re-check now and then in case a navigation reset the page's state.
 */
function watch() {
  const guide = document.querySelector('ytlr-guide-response');
  if (guide && guide !== watched) {
    watched = guide;
    new ResizeObserver(() => update(guide)).observe(guide);
  }
  if (watched) update(watched);
}

if (typeof ResizeObserver === 'function') {
  watch();
  setInterval(watch, 2000);
}
