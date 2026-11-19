import { artifactPath } from './lib/artifacts.mjs';
await page.screenshot(artifactPath('x.png'));
const m = fs.readFileSync(path.join(root, 'site/data/manifest.json'), 'utf8'); // wse-lint: ok (explicit skip above)
