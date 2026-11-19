// Tour stop 00: the app as first opened, home sheet at its opening height (Josh points 5, 11, 13).
// MVP shell: layout assertions are off (gate:false) and listed below until the owner package rewrites this stop.
export default {
  id: '00-boot',
  owner: 'W3-05',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: "measured on the MVP shell: the strip's day cells overlap their initials (desktop); the view-switch buttons are 40 px tall (phone)",
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run() { /* nothing to do: the runner has loaded the app and waited for idle */ },
};
