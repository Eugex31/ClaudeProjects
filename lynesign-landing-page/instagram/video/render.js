const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const here = __dirname;
const scratch = path.resolve(here, '..');
const mode = process.argv[2] || 'preview';

const b64 = p => fs.readFileSync(p).toString('base64');
const assets = {
  logo: 'data:image/png;base64,' + fs.readFileSync(path.join(scratch, 'web_images', 'logo_new.b64.txt'), 'utf8').trim(),
  imgs: ['barbershop4', 'gym5', 'laundromat2', 'restaurant3'].map(n => 'data:image/png;base64,' + b64(path.join(scratch, `cell2_${n}.png`)))
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--enable-features=PlatformHEVCEncoderSupport']
  });
  const page = await browser.newPage();
  page.on('console', m => console.log('[page]', m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.setViewport({ width: 1080, height: 1920 });
  const html = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;700;800;900&family=Space+Mono:wght@700&display=swap" rel="stylesheet">
</head><body style="margin:0;background:#000"></body></html>`;
  const server = require('http').createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: 'networkidle0' });
  const fontOk = await page.evaluate(async () => {
    await Promise.all(['500', '700', '800', '900'].map(w => document.fonts.load(`${w} 80px Montserrat`)));
    await document.fonts.load('700 30px "Space Mono"');
    return document.fonts.check('800 80px Montserrat') && document.fonts.check('700 30px "Space Mono"');
  });
  console.log('fonts loaded:', fontOk);
  await page.addScriptTag({ content: fs.readFileSync(path.join(here, 'anim.js'), 'utf8') });
  await page.evaluate(a => window.VID.init(a), assets);

  if (mode === 'preview') {
    const times = [1.5, 3.2, 5.8, 7.5, 8.9, 10.9, 12.9, 14.9, 17.6, 19.8, 22.5, 23.9];
    for (const t of times) {
      const data = await page.evaluate(tt => { window.VID.draw(tt); return window.VID.canvas.toDataURL('image/png'); }, t);
      fs.writeFileSync(path.join(here, `prev_${String(t).replace('.', '_')}.png`), Buffer.from(data.split(',')[1], 'base64'));
    }
    console.log('previews written');
  } else {
    const muxerSrc = fs.readFileSync(path.join(here, 'node_modules', 'mp4-muxer', 'build', 'mp4-muxer.mjs'), 'utf8');
    const t0 = Date.now();
    const out = await page.evaluate(src => window.VID.encode(src), muxerSrc);
    const file = path.join(here, 'lynesign_short.mp4');
    fs.writeFileSync(file, Buffer.from(out, 'base64'));
    console.log('video written', file, fs.statSync(file).size, 'bytes in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  }
  await browser.close();
  server.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
