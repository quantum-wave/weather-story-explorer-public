export const id = 'T-NET'; export const tier = 'network';
export async function run({ page, assert }) { assert.equal(await page.eval('1+1'), 2); }
