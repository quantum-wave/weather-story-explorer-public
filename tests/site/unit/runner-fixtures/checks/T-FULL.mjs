export const id = 'T-FULL'; // no tier: treated as full
export async function run({ page, assert }) { assert.equal(await page.eval('1+1'), 2); }
