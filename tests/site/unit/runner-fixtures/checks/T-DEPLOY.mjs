export const id = 'T-DEPLOY'; export const tier = 'deploy';
export async function run({ page, assert }) { assert.equal(await page.eval('1+1'), 2); }
