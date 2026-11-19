// Tour stop 22 (Night): the Night walk of tour stop 22 (coastlines, borders and state lines over the field on the Night ground).
// Night is the app's default theme, so no `theme` click is needed; the walk asserts the page really is dark.
import paper, { walk } from './22-linework.mjs';

export default {
  ...paper,
  id: '22-linework-night',
  ground: 'night',
  theme: undefined,
  async run(page, inp, { snap }) { return walk(page, inp, { snap }, 'dark'); },
};
