/* Browsertest af leadmodulet. Kør med:  npm install playwright jspdf && node test/module.test.js */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const nodePath = require('path');

const ROOT = nodePath.join(__dirname, '..');
const TMP = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'tc-test-'));
const path = nodePath.join(TMP, 'index.html');

/* Byg en testside af modulet. jsPDF hentes lokalt fra node_modules, så testen
   kan køre uden netadgang til CDN'et. */
(function buildPage() {
  const src = fs.readFileSync(nodePath.join(ROOT, 'torben-clausen-lead-modul.html'), 'utf8');
  let html = src;
  try {
    fs.copyFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), nodePath.join(TMP, 'jspdf.umd.min.js'));
    html = html.replace('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'jspdf.umd.min.js');
  } catch (e) {
    console.log('(jspdf ikke fundet lokalt - PDF-testen springes over)');
  }
  fs.writeFileSync(path, '<!doctype html><html lang="da"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Test</title>' +
    '<style>body{margin:0;background:#eee;font-family:Arial}</style></head><body>\n' + html + '\n</body></html>');
})();

const pass = [], fail = [];
function ok(c, m){ (c?pass:fail).push(m); console.log((c?'  PASS  ':'  FAIL  ')+m); }

(async () => {
  /* Sæt evt. CHROME_PATH, hvis Playwrights egen browser ikke er installeret. */
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const ctx = await b.newContext({ viewport:{width:1100,height:900}, acceptDownloads:true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
  await p.goto('file://'+path);
  await p.waitForTimeout(1200);

  const jspdf = await p.evaluate(()=> !!(window.jspdf && window.jspdf.jsPDF));
  console.log('\n== jsPDF loaded from CDN:', jspdf);

  const step = () => p.evaluate(()=> document.querySelector('.tcx-step.is-active').dataset.step);
  const insights = () => p.$$eval('#tcxInsights .tcx-insight', ns=>ns.map(n=>n.dataset.id));

  console.log('\n=== SCENARIE 1: Nedbrydning (villa, 140 m2, 1972, fundament) ===');
  ok(await step()==='1','Starter på trin 1');
  await p.click('.tcx-card[data-track="nedbrydning"]');
  ok(await step()==='2','Kort-klik går til trin 2');

  // forsøg at gå videre uden udfyldning
  await p.click('#tcxToLead');
  ok(await step()==='2','Blokerer videre uden svar');
  ok((await p.textContent('#tcxStep2Err')).length>10,'Viser fejlbesked ved tomme felter');
  ok(await p.$$eval('.tcx-fld.has-error',n=>n.length)===4,'Markerer alle 4 felter som fejl');

  await p.click('.tcx-fld[data-key="ejendomstype"] .tcx-opt[data-val="villa"]');
  await p.fill('.tcx-fld[data-key="m2"] input','140');
  await p.fill('.tcx-fld[data-key="byggeaar"] input','1972');
  await p.waitForTimeout(200);
  let ins = await insights();
  ok(ins.includes('asbest'),'Ekspert-indsigt "asbest" vises ved byggeår 1972');
  ok(!ins.includes('stor'),'Indsigt "stor" vises IKKE ved 140 m2');
  const insTxt = await p.textContent('#tcxInsights .tcx-insight');
  ok(insTxt.includes('Vidste du?')&&insTxt.includes('asbest'),'Asbest-tekst matcher specifikationen');

  await p.fill('.tcx-fld[data-key="m2"] input','500');
  await p.waitForTimeout(150);
  ok((await insights()).includes('stor'),'Indsigt "stor" fader ind ved 500 m2');
  await p.fill('.tcx-fld[data-key="m2"] input','140');
  await p.waitForTimeout(150);
  ok(!(await insights()).includes('stor'),'Indsigt fjernes igen når betingelsen ikke gælder');

  await p.click('.tcx-fld[data-key="fundament"] .tcx-opt[data-val="ja"]');
  await p.waitForTimeout(150);
  ok((await insights()).includes('fundament'),'Indsigt "fundament" vises');
  await p.click('#tcxToLead');
  ok(await step()==='3','Går til trin 3 (lead gate) når alt er udfyldt');

  // gate-validering
  await p.click('#tcxUnlock');
  ok(await step()==='3','Gate blokerer uden e-mail');
  await p.fill('#tcxEmail','ikke-en-email');
  await p.click('#tcxUnlock');
  ok((await p.textContent('.tcx-ferr[data-for="email"]')).includes('ikke helt rigtig'),'Afviser ugyldig e-mail');
  await p.fill('#tcxEmail','jens@byggefirma.dk');
  await p.fill('#tcxName','Jens Pedersen');
  await p.fill('#tcxPhone','1234');
  await p.click('#tcxUnlock');
  ok((await p.textContent('.tcx-ferr[data-for="telefon"]')).includes('8 cifre'),'Afviser for kort telefonnummer');
  await p.fill('#tcxPhone','20 30 40 50');
  await p.click('#tcxUnlock');
  ok((await p.textContent('.tcx-ferr[data-for="consent"]')).length>5,'Kræver samtykke (GDPR)');
  await p.check('#tcxConsent');
  await p.click('#tcxUnlock');
  ok(await step()==='4','Låser op til trin 4 ved gyldige data');

  const price = await p.textContent('#tcxPrice');
  console.log('   Pris vist:', price);
  const res = await p.evaluate(()=>{
    const rows=[...document.querySelectorAll('#tcxTable tr')].map(r=>[r.cells[0].innerText.split('\n')[0], r.cells[1].innerText]);
    return rows;
  });
  console.log('   Specifikation:'); res.forEach(r=>console.log('     -',r[0],'=>',r[1]));
  // forventet: 140*475 + 140*185 + 140*140 + 12500 = 124500
  ok(res[res.length-1][1].replace(/\D/g,'')==='124500','Beregning korrekt: 124.500 kr. (140m2 villa+miljø+fundament+etablering)');
  ok(price.includes('106.000')&&price.includes('143.000'),'Interval ±15 % afrundet: 106.000 – 143.000 kr.');
  const titel = await p.textContent('#tcxResultTitle');
  ok(titel.includes('Jens'),'Resultattitel personaliseres med fornavn');
  ok(await p.$$eval('#tcxSummary li',n=>n.length)===5,'Opsummering viser område + 4 svar');

  // PDF
  if (jspdf) {
    const [dl] = await Promise.all([ p.waitForEvent('download', {timeout:15000}), p.click('#tcxPdf') ]);
    const f = nodePath.join(TMP, dl.suggestedFilename());
    await dl.saveAs(f);
    const buf = fs.readFileSync(f);
    ok(buf.slice(0,4).toString()==='%PDF','PDF genereres og downloades');
    ok(/\/Count 2/.test(buf.toString('latin1')),'PDF har 2 sider');
    ok(dl.suggestedFilename()==='torben-clausen-projektrapport-jens-pedersen.pdf','PDF-filnavn indeholder kundenavn');
    console.log('   PDF:', dl.suggestedFilename(), Math.round(buf.length/1024)+' KB');
  } else { console.log('   (springer PDF-test over - CDN ikke tilgængelig)'); }

  console.log('\n=== SCENARIE 2: Transport (bigbags 8 t, 6100) ===');
  await p.click('#tcxRestart');
  ok(await step()==='1','Genstart går tilbage til trin 1');
  ok((await insights()).length===0,'Indsigter nulstilles ved genstart');
  await p.click('.tcx-card[data-track="transport"]');
  await p.click('.tcx-fld[data-key="materiale"] .tcx-opt[data-val="sand"]');
  await p.click('.tcx-fld[data-key="levering"] .tcx-opt[data-val="bigbag"]');
  await p.fill('.tcx-fld[data-key="maengde"] input','8');
  await p.fill('.tcx-fld[data-key="postnr"] input','6100');
  await p.waitForTimeout(200);
  ins = await insights();
  ok(ins.includes('bigbag5'),'Pro-tip om bigbags >5 tons vises');
  ok(ins.includes('zoneA'),'Zone A-indsigt vises ved postnr. 6100');
  ok((await p.textContent('#tcxInsights')).includes('Pro-tip'),'Pro-tip-tekst matcher specifikationen');
  await p.fill('.tcx-fld[data-key="maengde"] input','3');
  await p.waitForTimeout(150);
  ok(!(await insights()).includes('bigbag5'),'Pro-tip forsvinder ved 3 tons');
  await p.fill('.tcx-fld[data-key="maengde"] input','8');
  await p.fill('.tcx-fld[data-key="postnr"] input','12');
  await p.click('#tcxToLead');
  ok((await p.textContent('.tcx-fld[data-key="postnr"] .tcx-fld-err')).includes('postnummer'),'Validerer postnummer');
  await p.fill('.tcx-fld[data-key="postnr"] input','6100');
  await p.click('#tcxToLead');
  await p.fill('#tcxEmail','anne@firma.dk'); await p.check('#tcxConsent');
  await p.click('#tcxUnlock');
  const r2 = await p.evaluate(()=>[...document.querySelectorAll('#tcxTable tr')].map(r=>[r.cells[0].innerText.split('\n')[0],r.cells[1].innerText]));
  r2.forEach(r=>console.log('     -',r[0],'=>',r[1]));
  ok(r2[r2.length-1][1].replace(/\D/g,'')==='4110','Transportberegning: 1.160 + 2.200 + 750 = 4.110 kr.');
  ok((await p.textContent('#tcxResultTitle')).includes('Vejledende'),'Titel uden navn når navn ikke er oplyst');

  console.log('\n=== SCENARIE 3: Anlæg (kloak 60 lbm, ler, trange forhold) ===');
  await p.click('#tcxRestart');
  await p.click('.tcx-card[data-track="anlaeg"]');
  const lblFoer = await p.textContent('.tcx-fld[data-key="maengde"] .tcx-fld-label');
  await p.click('.tcx-fld[data-key="opgavetype"] .tcx-opt[data-val="kloak"]');
  const lblKloak = await p.textContent('.tcx-fld[data-key="maengde"] .tcx-fld-label');
  const unitKloak = await p.textContent('.tcx-fld[data-key="maengde"] .tcx-unit');
  await p.click('.tcx-fld[data-key="opgavetype"] .tcx-opt[data-val="jord"]');
  const unitJord = await p.textContent('.tcx-fld[data-key="maengde"] .tcx-unit');
  ok(lblKloak.includes('løbende meter')&&unitKloak==='lbm','Spørgsmål/enhed skifter dynamisk til lbm ved kloak');
  ok(unitJord==='m³','Enhed skifter til m³ ved jordarbejde');
  await p.click('.tcx-fld[data-key="opgavetype"] .tcx-opt[data-val="kloak"]');
  await p.fill('.tcx-fld[data-key="maengde"] input','60');
  await p.click('.tcx-fld[data-key="jordtype"] .tcx-opt[data-val="ler"]');
  await p.click('.tcx-fld[data-key="adgang"] .tcx-opt[data-val="traang"]');
  await p.waitForTimeout(200);
  ins = await insights();
  ok(ins.includes('ler'),'Ler-indsigt vises');
  ok(ins.includes('kloak')&&ins.includes('traang'),'Kloak- og adgangsindsigt vises');
  ok((await p.textContent('#tcxInsights')).includes('Overvej genindbygning'),'Ler-tekst matcher specifikationen');
  await p.click('#tcxToLead');
  await p.fill('#tcxEmail','ib@entreprise.dk'); await p.fill('#tcxName','Ib Sørensen'); await p.check('#tcxConsent');
  const lead = await p.evaluate(()=> new Promise(r=>{ document.addEventListener('tc:lead', e=>r(e.detail), {once:true}); document.getElementById('tcxUnlock').click(); }));
  const r3 = await p.evaluate(()=>[...document.querySelectorAll('#tcxTable tr')].map(r=>[r.cells[0].innerText.split('\n')[0],r.cells[1].innerText]));
  r3.forEach(r=>console.log('     -',r[0],'=>',r[1]));
  ok(r3[r3.length-1][1].replace(/\D/g,'')==='123842','Anlægsberegning: 87.000+9.900+17.442+9.500 = 123.842 kr.');
  ok(lead && lead.lead.email==='ib@entreprise.dk' && lead.estimat.min>0,'tc:lead-event udsendes med komplet payload');
  console.log('   Lead-payload:', JSON.stringify(lead).slice(0,220)+'…');

  console.log('\n=== SCENARIE 4: Affald (blandet 6 t, ingen sortering, container) ===');
  await p.click('#tcxRestart');
  await p.click('.tcx-card[data-track="affald"]');
  await p.click('.tcx-fld[data-key="affaldstype"] .tcx-opt[data-val="blandet"]');
  await p.fill('.tcx-fld[data-key="maengde"] input','6');
  await p.click('.tcx-fld[data-key="sortering"] .tcx-opt[data-val="nej"]');
  await p.click('.tcx-fld[data-key="haandtering"] .tcx-opt[data-val="container"]');
  await p.waitForTimeout(200);
  ins = await insights();
  ok(ins.includes('blandet')&&ins.includes('usorteret'),'Sorterings-indsigter vises');
  ok((await p.textContent('#tcxInsights')).includes('Kildesortering'),'Kildesorterings-tekst matcher specifikationen');
  await p.click('#tcxToLead');
  await p.fill('#tcxEmail','drift@bolig.dk'); await p.check('#tcxConsent'); await p.click('#tcxUnlock');
  const r4 = await p.evaluate(()=>[...document.querySelectorAll('#tcxTable tr')].map(r=>[r.cells[0].innerText.split('\n')[0],r.cells[1].innerText]));
  r4.forEach(r=>console.log('     -',r[0],'=>',r[1]));
  ok(r4[r4.length-1][1].replace(/\D/g,'')==='12290','Affaldsberegning: 8.700 + 1.740 + 1.850 = 12.290 kr.');

  // sorteret variant skal give rabat og lavere pris
  await p.click('.tcx-step[data-step="4"] [data-goto="2"]');
  ok(await step()==='2','Kan gå tilbage fra resultatet og rette svar');
  await p.click('.tcx-fld[data-key="sortering"] .tcx-opt[data-val="ja"]');
  await p.click('#tcxToLead');
  ok(await step()==='4','Springer lead-gaten over ved genberegning');
  const r4b = await p.evaluate(()=>[...document.querySelectorAll('#tcxTable tr')].map(r=>r.cells[1].innerText));
  ok(r4b[r4b.length-1].replace(/\D/g,'')==='9506','Sortering giver rabat: 12.290 → 9.506 kr.');

  // honeypot
  console.log('\n=== Diverse ===');
  await p.click('#tcxRestart');
  await p.click('.tcx-card[data-track="affald"]');
  await p.click('.tcx-fld[data-key="affaldstype"] .tcx-opt[data-val="beton"]');
  await p.fill('.tcx-fld[data-key="maengde"] input','10');
  await p.click('.tcx-fld[data-key="sortering"] .tcx-opt[data-val="ja"]');
  await p.click('.tcx-fld[data-key="haandtering"] .tcx-opt[data-val="selv"]');
  await p.click('#tcxToLead');
  await p.fill('#tcxEmail','bot@spam.dk'); await p.check('#tcxConsent');
  await p.evaluate(()=>{document.getElementById('tcxHp').value='spam';});
  await p.click('#tcxUnlock');
  ok(await step()==='3','Honeypot stopper bot-indsendelse');
  await p.evaluate(()=>{document.getElementById('tcxHp').value='';});
  await p.click('#tcxUnlock');
  ok(await step()==='4','Rigtig bruger kommer igennem');

  ok(errors.length===0,'Ingen JS-fejl i konsollen'+(errors.length?': '+errors.join(' | '):''));

  console.log('\n================ RESULTAT: '+pass.length+' bestået, '+fail.length+' fejlet ================');
  if(fail.length) fail.forEach(f=>console.log('  FEJL: '+f));
  await b.close();
  process.exit(fail.length?1:0);
})();
