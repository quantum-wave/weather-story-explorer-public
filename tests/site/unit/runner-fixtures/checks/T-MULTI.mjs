export const id = 'T-MULTI'; export const tier = 'deploy';
export const data = ['synthetic', 'sample-min'];
export async function run({ page, assert, fixture, dataDir }) {
  assert.ok(dataDir.endsWith(fixture), `data dir ${dataDir} is the ${fixture} fixture`);
  const m = await (await import('node:fs')).promises.readFile(dataDir + '/manifest.json', 'utf8');
  if (fixture === 'sample-min' && process.env.T_MULTI_FAIL) assert.fail('sample-min is the failing fixture');
  assert.ok(JSON.parse(m).fields);
}
