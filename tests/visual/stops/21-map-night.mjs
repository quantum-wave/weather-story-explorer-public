// Tour stop 21: the Pattern lens on the Night ground (a construction: the orange arm keeps its Paper hex, the blue arm is lifted
// to clear 3:1 on the dark ground). The same walk as stop 20. Owner W3-01.
import paper, { walk } from './20-map-pattern.mjs';

export default {
  ...paper,
  id: '21-map-night',
  ground: 'night',
  theme: undefined,
  async run(page, inp, { snap }) { return walk(page, inp, { snap }, 'dark'); },
};
