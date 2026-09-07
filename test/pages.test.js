/* Test af demosiden (index.html), som den serveres af GitHub Pages.
   Starter sin egen lille webserver, så testen ikke kræver andet end Playwright.
   Kør med:  npm install playwright jspdf && node test/pages.test.js          */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const nodePath = require('path');

const ROOT = nodePath.join(__dirname, '..');
const pass = [], fail = [];
const ok = (c, m) => { (c ? pass : fail).push(m); console.log((c ? '  PASS  ' : '  FAIL  ') + m); };

/* Serveringsmappe: en kopi af repoet, hvor jsPDF hentes lokalt i stedet for
   fra CDN, så testen kan køre uden netadgang. */
const DIR = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'tc-pages-'));
let harJsPdf = false;
(function forbered() {
  fs.copyFileSync(nodePath.join(ROOT, 'index.html'), nodePath.join(DIR, 'index.html'));
  let modul = fs.readFileSync(nodePath.join(ROOT, 'torben-clausen-lead-modul.html'), 'utf8');
  try {
    fs.copyFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), nodePath.join(DIR, 'jspdf.umd.min.js'));
    modul = modul.replace('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'jspdf.umd.min.js');
    harJsPdf = true;
  } catch (e) {
    console.log('(jspdf ikke fundet lokalt - PDF-testen springes over)');
  }
  fs.writeFileSync(nodePath.join(DIR, 'torben-clausen-lead-modul.html'), modul);
})();

const TYPER = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const navn = nodePath.basename(decodeURIComponent(req.url.split('?')[0])) || 'index.html';
  const fil = nodePath.join(DIR, navn === '' ? 'index.html' : navn);
  if (!fil.startsWith(DIR) || !fs.existsSync(fil) || fs.statSync(fil).isDirectory()) {
    res.writeHead(404); res.end('ikke fundet'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPER[nodePath.extname(fil)] || 'application/octet-stream' });
  res.end(fs.readFileSync(fil));
});

/* Måler hvad iframen *burde* være høj, uafhængigt af hvad den faktisk er. */
const maal = p => p.evaluate(() => {
  const f = document.getElementById('modul'), d = f.contentDocument;
  const el = d.getElementById('tcx');
  const v = d.defaultView;
  const behov = Math.ceil(el.getBoundingClientRect().bottom
    + (parseFloat(v.getComputedStyle(el).marginBottom) || 0)
    + (parseFloat(v.getComputedStyle(d.body).marginBottom) || 0));
  return { iframe: Math.round(f.getBoundingClientRect().height), behov };
});

server.listen(0, async () => {
  const URL = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const fejl = [];
  p.on('pageerror', e => fejl.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') fejl.push('console: ' + m.text()); });

  await p.goto(URL);
  await p.waitForTimeout(1500);
  const fr = p.frameLocator('#modul');

  ok(await fr.locator('.tcx-card').count() === 4, 'Modulet indlejres og viser sine fire kort');

  let m = await maal(p);
  ok(Math.abs(m.iframe - m.behov) <= 2, `Iframens højde passer til indholdet (${m.iframe}px)`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)),
     'Ingen vandret scroll');

  /* Højden skal både kunne vokse og krympe igen - body.scrollHeight kan kun
     vokse, så her fanges en klassisk fastlåsning. */
  await fr.locator('.tcx-card[data-track="affald"]').click();
  await fr.locator('.tcx-fld[data-key="affaldstype"] .tcx-opt[data-val="blandet"]').click();
  await p.waitForTimeout(900);
  const stor = await maal(p);
  ok(stor.iframe > m.iframe, `Højden vokser med indholdet (${m.iframe} -> ${stor.iframe}px)`);
  ok(Math.abs(stor.iframe - stor.behov) <= 2, 'Pasform holder efter vækst');

  await fr.locator('.tcx-step[data-step="2"] [data-goto="1"]').click();
  await p.waitForTimeout(900);
  const lille = await maal(p);
  ok(lille.iframe < stor.iframe, `Højden krymper igen (${stor.iframe} -> ${lille.iframe}px)`);
  ok(Math.abs(lille.iframe - lille.behov) <= 2, 'Pasform holder efter krympning');

  await p.setViewportSize({ width: 400, height: 900 });
  await p.waitForTimeout(1200);
  m = await maal(p);
  ok(Math.abs(m.iframe - m.behov) <= 2, `Pasform holder på mobil (${m.iframe}px)`);
  await p.setViewportSize({ width: 1100, height: 900 });
  await p.waitForTimeout(1000);
  m = await maal(p);
  ok(Math.abs(m.iframe - m.behov) <= 2, 'Pasform holder tilbage på desktop');

  /* Et helt forløb skal kunne gennemføres inde i iframen - inkl. PDF-download */
  await fr.locator('.tcx-card[data-track="nedbrydning"]').click();
  await fr.locator('.tcx-fld[data-key="ejendomstype"] .tcx-opt[data-val="villa"]').click();
  await fr.locator('.tcx-fld[data-key="m2"] input').fill('140');
  await fr.locator('.tcx-fld[data-key="byggeaar"] input').fill('1972');
  await fr.locator('.tcx-fld[data-key="fundament"] .tcx-opt[data-val="ja"]').click();
  await fr.locator('#tcxToLead').click();
  await fr.locator('#tcxEmail').fill('jens@byggefirma.dk');
  await fr.locator('#tcxName').fill('Jens Pedersen');
  await fr.locator('#tcxConsent').check();
  await fr.locator('#tcxUnlock').click();
  await p.waitForTimeout(600);
  ok((await fr.locator('#tcxPrice').textContent()).includes('106.000'), 'Beregningen virker inde i iframen');

  if (harJsPdf) {
    const [dl] = await Promise.all([
      p.waitForEvent('download', { timeout: 20000 }),
      fr.locator('#tcxPdf').click()
    ]);
    ok(dl.suggestedFilename().endsWith('.pdf'), 'PDF kan hentes fra iframen: ' + dl.suggestedFilename());
  }

  ok(fejl.length === 0, 'Ingen JS-fejl' + (fejl.length ? ': ' + fejl.join(' | ') : ''));

  console.log('\n================ RESULTAT: ' + pass.length + ' bestået, ' + fail.length + ' fejlet ================');
  if (fail.length) { fail.forEach(f => console.log('  FEJL: ' + f)); }
  await b.close();
  server.close();
  process.exit(fail.length ? 1 : 0);
});
