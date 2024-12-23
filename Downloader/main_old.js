import { google } from "googleapis";
import fs from 'fs';
import { tokenManager } from "./tokenManager.js";
(await import('dotenv')).config({
    path: './secret/config.env',
    debug: true
});

const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } = process.env,
    manager = new tokenManager({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI, tokenPath: 'secret/token.json' });

if (!manager.loadToken()) throw 'LOAD TOKEN FAILED!';

const youtube = google.youtube('v3'),
    video = await youtube.videos.list({
        auth: manager.getAuthClient(),
        part: 'snippet,contentDetails',
        myRating: 'like',
        maxResults: 1,
        // pageToken: nextPageToken
    });

const channelsinfo = (await (youtube.channels.list({ auth: manager.getAuthClient(), mine: true, part: 'snippet,contentDetails,statistics' }))).data;
fs.writeFileSync('channels.json', JSON.stringify(channelsinfo));

let likedMusic = [];
let nextPageToken = null;

// first, retrieve *all* liked videos
do {
    const response = await youtube.videos.list({
        auth: manager.getAuthClient(),
        part: 'snippet,contentDetails',
        myRating: 'like',
        maxResults: 50,
        pageToken: nextPageToken
    });

    if (response.data.items) {
        likedMusic = likedMusic.concat(response.data.items.filter(o => o.snippet?.categoryId === '10').map(o => o.snippet.title))
        // snippet.categoryId should be present under `video.snippet`
        const t = response.data.items.find(video => video.snippet.title === 'Peeping Tom (feat. Rosie Harte)')
        if (t) {
            fs.writeFileSync('temp.json', JSON.stringify(t));
            break;
        }
        // likedMusic = likedMusic.concat(response.data.items.filter((video) => video.snippet?.categoryId === '10'));
    }

    nextPageToken = response.data.nextPageToken;
} while (nextPageToken);

// console.log('not found!');
fs.writeFileSync('temp.json', JSON.stringify(likedMusic))