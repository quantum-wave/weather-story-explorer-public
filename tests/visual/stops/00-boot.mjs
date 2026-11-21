// Tour stop 00: the app as first opened, home sheet at its opening height (Josh points 5, 11, 13).
// MVP shell: layout assertions are off (gate:false) and listed below until the shell and home packages (W3-04, W3-06) land; W3-05 keeps the
// stop running and adds the loading, failure and Expand stops (11, 13).
export default {
  id: '00-boot',
  owner: 'W3-05',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: "measured on the MVP shell: the strip's day cells overlap their initials (desktop, home.js, W3-06); the view-switch buttons are 40 px tall (phone, shell.css, W3-04)",
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run() { /* nothing to do: the runner has loaded the app and waited for idle */ },
};
