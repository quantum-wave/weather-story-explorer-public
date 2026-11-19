// Self-test stop (W1-01): its run throws, so the tour must fail even though the stop is not gated.
export default { id: '02-throws', owner: 'W1-01', gate: false, mvpFails: [], viewports: ['desktop'], url: 'data:text/html,<p>x</p>', async run() { throw new Error('selftest: the stop could not reach its state'); } };
