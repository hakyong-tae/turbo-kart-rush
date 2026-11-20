// The game's own DRIFT KART wordmark, lifted out of the CrazyGames-edition lobby onto a
// transparent background (DPR 4, so it stays crisp at cover size).
//
//   WORK=<dir> node tools/marketing/crazygames-logo.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
// lib.mjs reads BASE as it loads, so the default port is set first and the import comes after.
process.env.BASE = process.env.BASE || 'http://localhost:4942';
const { launch, openGame, sleep } = await import('./lib.mjs');
const WORK = process.env.WORK;
mkdirSync(WORK, { recursive: true });
const browser = await launch();
try {
  const page = await openGame(browser, { width: 1280, height: 720, dpr: 4, lang: 'en', query: '&lobby' });
  await sleep(1500);
  const info = await page.evaluate(() => {
    const logo = document.querySelector('.panel-title-screen .logo');
    const html = logo.outerHTML;
    const holder = document.createElement('div');
    holder.id = '__logo';
    holder.style.cssText = 'position:fixed;left:0;top:0;padding:40px 60px;';
    holder.appendChild(logo);
    document.body.appendChild(holder);
    for (const n of [...document.body.children]) if (n !== holder) n.style.display = 'none';
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return html;
  });
  console.log(info);
  await sleep(500);
  writeFileSync(`${WORK}/logo.png`, await page.locator('#__logo').screenshot({ omitBackground: true }));
  await page.context().close();
} finally {
  await browser.close();
}
