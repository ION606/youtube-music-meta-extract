// APPARENTLY the youtube api just....doesn't return all likes for some reason.....

import { chromium } from 'playwright';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const urltostr = (u) => {
    try {
        return new URL(u);
    }
    catch (err) {
        return null;
    }
}

async function scrapeLikedVideos() {
    const browser = await chromium.launchPersistentContext('bdata', {
        headless: false, // youtube breaks in headless
        args: ['--disable-blink-features=AutomationControlled']
    });

    const page = await browser.newPage();

    console.log("Opening YouTube...");
    await page.goto('https://music.youtube.com/', { waitUntil: 'networkidle' });

    // Step Log in or die
    if (await page.locator('[aria-label="Sign in"]').isVisible()) {
        console.log("Logging in...");

        await page.click('[aria-label="Sign in"]');
        await page.waitForNavigation({ waitUntil: 'networkidle' });

        console.log(page.url());
        await page.waitForURL('https://music.youtube.com/').catch(console.error);

        console.log("Login successful");
    } else {
        console.log("Already logged in");
    }

    // Navigate to "Liked Videos" playlist
    console.log("Navigating to Liked Videos...");
    await page.goto('https://music.youtube.com/playlist?list=LM', { waitUntil: 'domcontentloaded' });

    // Scroll to load all liked videos
    console.log("Scrolling through Liked Videos...");
    const s = new Set();
    let previousHeight = 0;
    while (true) {
        const currentHeight = await page.evaluate(() => document.body.scrollHeight);
        if (currentHeight === previousHeight) break;

        previousHeight = currentHeight;
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000); // Wait for new content to load

        // sloppy and repetative to do it every time, but otherwise it won't work as the incoming videos won't all appear
        (await page.evaluate(() => {
            const videos = Array.from(document.querySelector('#contents').querySelectorAll('.title .yt-simple-endpoint'));
            return videos.map(video => video.href.replace('&list=LM', ''));
        })).map(u => s.add(u));
    }

    // // Scrape video data
    // console.log("Scraping liked videos...");
    // const likedVideos = await page.evaluate(() => {
    //     const videos = Array.from(document.querySelector('#contents').querySelectorAll('.title .yt-simple-endpoint'));
    //     return videos.map(video => video.href);
    // });

    // console.log(`Found ${likedVideos.length} liked videos.`);
    // console.log(likedVideos);

    // Close the browser
    await browser.close();

    // Save the results to a JSON file
    fs.writeFileSync('liked_videos.json', JSON.stringify([...s], null, 2));
    console.log("Liked videos saved to liked_videos.json");

    return [...s];
}

// Run the scraper
(async () => {
    try {
        await scrapeLikedVideos();
    } catch (error) {
        console.error("Error scraping liked videos:", error);
    }
})();
