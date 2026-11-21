// The edit sheet: the same sheet and fields as Add, filled from the item, with Save, Cancel and Remove (inline confirm, then a
// 5 second Undo). Opened from a card's "..." button. Nothing is stored until Save (design spec 8.2).
import { pins as defaultPins } from './index.js';
import { openEditFlow } from './addsheet.js';

let open = null;

export function closeEditSheet() { open?.close('close'); }

/**
 * @param {string} id pin or trip id
 * @param {{pins?:object, gazetteer?:object, opener?:HTMLElement}} [o]
 * @returns {{close:Function, sheet:object}|null}
 */
export function openEditSheet(id, { pins = defaultPins, gazetteer } = {}) {
  const h = openEditFlow(id, { pins, ...(gazetteer ? { gazetteer } : {}) });
  open = h;
  return h;
}
