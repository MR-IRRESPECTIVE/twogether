const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });

  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  const logMsg = async (pageName, msg) => {
    try {
      const args = await Promise.all(msg.args().map(a => a.jsonValue()));
      console.log(`${pageName}:`, ...args);
    } catch(e) {
      console.log(`${pageName} (text):`, msg.text());
    }
  };

  pageA.on('console', msg => logMsg('A', msg));
  pageB.on('console', msg => logMsg('B', msg));

  console.log("Navigating to app...");
  await pageA.goto('http://localhost:5173/');
  await pageB.goto('http://localhost:5173/');

  const clickBtn = async (page, text) => {
    await page.evaluate((t) => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.innerText.includes(t));
      if(btn) btn.click();
    }, text);
  };

  // Page A: Host Room
  console.log("Page A hosting room...");
  await clickBtn(pageA, "HOST A ROOM");
  await pageA.waitForSelector('input[placeholder="e.g. Alex"]');
  await pageA.type('input[placeholder="e.g. Alex"]', 'Alice');
  await clickBtn(pageA, "CREATE ROOM");

  const delay = ms => new Promise(r => setTimeout(r, ms));
  // Wait for A to enter room and get room code
  await pageA.waitForSelector('h2'); 
  await delay(2000);
  const urlA = pageA.url();
  const roomCode = urlA.split('/').pop();
  console.log("Room code is:", roomCode);

  // Page B: Join Room
  console.log("Page B joining room...");
  await clickBtn(pageB, "JOIN A ROOM");
  await pageB.waitForSelector('input[placeholder="6-letter code"]');
  await pageB.type('input[placeholder="6-letter code"]', roomCode);
  await pageB.type('input[placeholder="e.g. Jamie"]', 'Bob');
  await clickBtn(pageB, "JOIN ROOM");

  // Both should be in Lobby now
  console.log("Both in Lobby, starting booth...");
  await delay(3000);
  await clickBtn(pageA, "START BOOTH");


  // Wait for booth to load
  await delay(5000);
  
  // Capture photo
  console.log("Capturing photo...");
  await pageA.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const captureBtn = btns.find(b => b.style.width === '64px' || b.innerHTML.includes('circle')); 
    if(captureBtn) captureBtn.click();
    else {
      // Find the circular button in BoothPage CaptureButton
      const allBtns = Array.from(document.querySelectorAll('button'));
      allBtns[allBtns.length - 2].click(); 
    }
  });

  await delay(5000); // Wait for countdown and flash

  // Click Finish
  console.log("Finishing booth...");
  await pageA.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const finishBtn = btns.find(b => b.innerText.includes('FINISH'));
    if(finishBtn) finishBtn.click();
  });

  await delay(2000);

  // In Selection page, select photos and confirm
  console.log("Confirming selection...");
  await pageA.evaluate(() => {
    const photo = document.querySelector('.photo-item');
    if(photo) photo.click();
    
    const confirm = document.querySelector('.btn-confirm');
    if(confirm) confirm.click();
  });

  await delay(2000);

  // In Customize page, click + Text
  console.log("Clicking + Text...");
  await pageA.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const textBtn = btns.find(b => b.innerText.includes('+ Text'));
    if(textBtn) textBtn.click();
  });

  await delay(2000);

  console.log("Done. Closing browser...");
  await browser.close();
})();
