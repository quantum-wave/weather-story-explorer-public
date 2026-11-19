// Tour stop 07: dark and light themes, switched with the header button (Josh points 6, 7, 14).
// MVP shell: gate:false; the owner package rewrites this stop and sets gate:true. mvpFails: assertion numbers of spec 14.3
// (1 overlap, 2 hscroll, 3 textsize, 4 clipped, 5 target).
export default {
  id: '07-themes',
  owner: 'W3-04',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: "measured on the MVP shell: the strip's day cells overlap their initials (desktop); the view-switch buttons are 40 px tall (phone)",
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    await snap('dark');
    await inp.activate('#btn-theme');
    await page.waitFor(`document.documentElement.dataset.theme === 'light'`, { timeout: 5000 });
  },
};
