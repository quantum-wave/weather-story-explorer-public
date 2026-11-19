// Live bindings the frame needs from the rest of the app, behind one seam so tests can substitute them.
import * as dataMod from '../data/index.js';
export const data = dataMod;
/** The renderer lives on window.__wse (created by main.js); `setRenderer` overrides it for tests and embedding. */
let override = null;
export const setRenderer = (r) => { override = r; };
export const getRenderer = () => {
  const r = override || globalThis.__wse?.renderer;
  if (!r || typeof r.renderTo !== 'function') throw new Error('share: no renderer available');
  return r;
};
