const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });

  const page1 = await browser.newPage();
  const page2 = await browser.newPage();

  page1.on('console', msg => {
    if (msg.text().includes('[WEBRTC]') || msg.text().includes('[MEDIA]') || msg.text().includes('[ROOM]')) {
      console.log('PAGE 1:', msg.text());
    }
  });

  page2.on('console', msg => {
    if (msg.text().includes('[WEBRTC]') || msg.text().includes('[MEDIA]') || msg.text().includes('[ROOM]')) {
      console.log('PAGE 2:', msg.text());
    }
  });

  await page1.goto('http://localhost:5174/');
  
  // Wait a bit
  await new Promise(r => setTimeout(r, 2000));
  
  await page2.goto('http://localhost:5174/');
  
  // Wait enough time for negotiation
  await new Promise(r => setTimeout(r, 10000));
  
  await browser.close();
})();
