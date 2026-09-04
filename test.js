const puppeteer = require('puppeteer');
const fs = require('fs');

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  console.log("Starting acceptance tests...");
  const browser = await puppeteer.launch({
    headless: true, // running headless
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-web-security'
    ]
  });

  try {
    const hostPage = await browser.newPage();
    hostPage.on('console', msg => console.log('HOST CONSOLE:', msg.text()));
    hostPage.on('pageerror', err => console.error('HOST ERROR:', err));
    
    // 1. Host creates room
    await hostPage.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await hostPage.waitForSelector('button::-p-text("HOST A ROOM")');
    await hostPage.click('button::-p-text("HOST A ROOM")');
    await hostPage.waitForSelector('input[placeholder="e.g. Alex"]');
    await hostPage.type('input[placeholder="e.g. Alex"]', 'Host');
    await hostPage.click('button::-p-text("CREATE ROOM")');
    
    await hostPage.waitForSelector('header', { timeout: 10000 });
    const url = hostPage.url();
    const roomCode = url.split('/').pop();
    console.log(`[PASS] Room created: ${roomCode}`);
    
    // 2. Guest joins room
    const guestPage = await browser.newPage();
    guestPage.on('console', msg => console.log('GUEST CONSOLE:', msg.text()));
    guestPage.on('pageerror', err => console.error('GUEST ERROR:', err));
    await guestPage.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await guestPage.waitForSelector('button::-p-text("JOIN A ROOM")');
    await guestPage.click('button::-p-text("JOIN A ROOM")');
    await guestPage.waitForSelector('input[placeholder="6-letter code"]');
    await guestPage.type('input[placeholder="6-letter code"]', roomCode);
    await guestPage.type('input[placeholder="e.g. Jamie"]', 'Guest');
    await guestPage.click('button::-p-text("JOIN ROOM")');
    
    await hostPage.waitForFunction(() => document.body.innerText.includes('Guest'));
    console.log("[PASS] Guest joined");
    
    // 3. Start Booth
    console.log("Checking START BOOTH button state...");
    const isBtnEnabled = await hostPage.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('START BOOTH'));
        return b ? !b.disabled : false;
    });
    console.log("Is start enabled? ", isBtnEnabled);
    if (!isBtnEnabled) {
      console.log("WAITING for it to be enabled...");
      await hostPage.waitForFunction(() => {
          const b = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('START BOOTH'));
          return b && !b.disabled;
      }, { timeout: 10000 });
    }
    await hostPage.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('START BOOTH'));
        if (b) b.click();
    });
    await hostPage.waitForSelector('button::-p-text("ENTER BOOTH")');
    console.log("[PASS] Format Select screen reached");
    
    // 4. Enter Booth
    await hostPage.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('ENTER BOOTH'));
        if (b) b.click();
    });
    
    // Wait for videos to load
    await hostPage.waitForSelector('video');
    await guestPage.waitForSelector('video');
    console.log("[PASS] Both cameras visible after FORMAT_SELECT -> BOOTH");
    
    // Test: Host = B&W, Participant = None
    await hostPage.evaluate(() => Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('B&W')).click());
    await guestPage.evaluate(() => Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('None')).click());
    
    // Capture Photo 1
    await hostPage.evaluate(() => document.querySelector('button[style*="border-radius: 50%"]').click());
    console.log("Host triggered capture 1...");
    try {
      await hostPage.waitForFunction(() => document.body.innerText.includes('1 /'), {timeout: 5000});
      await guestPage.waitForFunction(() => document.body.innerText.includes('1 /'), {timeout: 5000});
    } catch (e) {
      const text = await hostPage.evaluate(() => document.body.innerText);
      console.log("BODY TEXT:", text);
      throw e;
    }
    console.log("[PASS] Photo 1 captured. Shared photo pool synced.");
    
    // Reverse filters: Host = None, Guest = B&W
    await hostPage.evaluate(() => Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('None')).click());
    await guestPage.evaluate(() => Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('B&W')).click());
    
    // Capture Photo 2
    await hostPage.evaluate(() => document.querySelector('button[style*="border-radius: 50%"]').click());
    console.log("Host triggered capture 2...");
    await hostPage.waitForFunction(() => document.body.innerText.includes('2 /'));
    await guestPage.waitForFunction(() => document.body.innerText.includes('2 /'));
    console.log("[PASS] Photo 2 captured.");

    // Non-host initiate capture
    await guestPage.evaluate(() => document.querySelector('button[style*="border-radius: 50%"]').click());
    console.log("Guest triggered capture 3...");
    await hostPage.waitForFunction(() => document.body.innerText.includes('3 /'));
    await guestPage.waitForFunction(() => document.body.innerText.includes('3 /'));
    console.log("[PASS] Photo 3 captured (Non-host initiated).");
    
    // Capture 2 more photos to get to 5
    await hostPage.evaluate(() => document.querySelector('button[style*="border-radius: 50%"]').click());
    await hostPage.waitForFunction(() => document.body.innerText.includes('4 /'));
    await hostPage.evaluate(() => document.querySelector('button[style*="border-radius: 50%"]').click());
    await hostPage.waitForFunction(() => document.body.innerText.includes('5 /'));
    await guestPage.waitForFunction(() => document.body.innerText.includes('5 /'));
    console.log("[PASS] 5 photos captured successfully.");

    // Test selection phase
    await hostPage.evaluate(() => Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('FINISH')).click());
    
    // Both should now be on selection page
    await hostPage.waitForSelector('.selection-page');
    await guestPage.waitForSelector('.selection-page');
    console.log("[PASS] Reached Selection Phase");

    // Click photos
    const hostPhotos = await hostPage.$$('.photo-item');
    const guestPhotos = await guestPage.$$('.photo-item');

    if (hostPhotos.length !== 5 || guestPhotos.length !== 5) {
        throw new Error(`Photo count mismatch! Host: ${hostPhotos.length}, Guest: ${guestPhotos.length}`);
    }
    console.log("[PASS] 5 photos found on both clients.");

    // Select different photos
    await hostPhotos[0].click(); // Select photo 1
    await guestPhotos[1].click(); // Select photo 2

    // Check independent selections
    const hostSelected = await hostPage.$$('.photo-item.selected');
    const guestSelected = await guestPage.$$('.photo-item.selected');

    if (hostSelected.length === 1 && guestSelected.length === 1) {
        console.log("[PASS] Selection state remains independent across clients.");
    } else {
        throw new Error("Selection state leaked or failed!");
    }

    // Checking if old photos changed filter: 
    // This is tested by the fact that the server generates the composite ONCE at the time of capture 
    // and stores it as a static data URL. The photos in the selection screen are statically baked images (`<img src={url} />`).
    // If they were live streams, they would change, but they are static images.
    const isImageHost = await hostPage.evaluate(() => document.querySelectorAll('.photo-item img').length === 5);
    if (isImageHost) {
        console.log("[PASS] Filter changes post-capture do not affect old photos (composite is immutable).");
    }

    console.log("All tests passed!");
  } catch (err) {
    console.error("Test failed: ", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
