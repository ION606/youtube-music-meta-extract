import express from 'express';
import { google } from 'googleapis';
import open from 'open';
import fs from 'fs';
import path from 'path';
import { tokenManager } from './tokenManager.js';

(await import('dotenv')).config({
    path: './Downloader/secret/config.env',
    debug: true
});


const app = express();
const port = 3000;


const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } = process.env,
    manager = new tokenManager({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI, tokenPath: 'Downloader/secret/token.json' });

const oauth2Client = manager.getAuthClient();


// scope to read playlist items/liked videos
const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];

let downloadStatus = 'idle'; // can be: 'idle', 'in-progress', 'completed', 'error'


//#region oauth flow

app.get('/auth', async (_req, res) => {
    const t = manager.loadToken();
    if (t) return res.redirect('/choose-playlist');

    // generate auth url
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES
    });

    // automatically open the url in the default browser
    const c = await open(authUrl).catch((err) => {
        console.error('error opening browser:', err);
        return res.status(500).send('failed to open browser for oauth.');
    });

    c.on('close', () => res.redirect('/choose-playlist'))
});



app.get('/oauth2callback', async (req, res) => {
    try {
        const code = req.query.code;
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        manager.saveToken(tokens);

        // close the window
        res.sendStatus(200);
    } catch (err) {
        console.error('error retrieving token:', err);
        res.status(500).send('error retrieving token.');
    }
});

//#endregion


//#region youtube stuffs

async function getAllPlaylists(auth) {
    const youtube = google.youtube('v3');
    let playlists = [];
    let nextPageToken = null;

    do {
        const response = await youtube.playlists.list({
            auth,
            part: 'snippet',
            mine: true,
            maxResults: 50,
            pageToken: nextPageToken
        });

        if (response.data.items) {
            playlists = playlists.concat(response.data.items);
        }

        nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    return playlists;
}

async function getPlaylistItems(playlistId, auth) {
    const youtube = google.youtube('v3');
    let items = [];
    let nextPageToken = null;

    do {
        const response = await youtube.playlistItems.list({
            auth,
            part: 'snippet,contentDetails',
            playlistId,
            maxResults: 50,
            pageToken: nextPageToken
        });

        if (response.data.items) {
            items = items.concat(response.data.items);
        }

        nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    return items.map(o => `https://music.youtube.com/watch?v=${o.id}`);
}

//#endregion


//#region routes

app.get('/choose-playlist', async (_req, res) => {
    try {
        if (!oauth2Client.credentials || !oauth2Client.credentials.access_token) {
            const t = manager.loadToken();
            if (!t) return res.redirect('/auth');
        }

        const playlists = await getAllPlaylists(oauth2Client);

        let html = `
    <html>
    <head>
      <title>choose playlist</title>
      <style>
        body { font-family: sans-serif; }
        #container { margin: 20px; }
        select, button { margin-top: 10px; }
      </style>
    </head>
    <body>
      <div id="container">
        <h1>choose a playlist to download</h1>
        <select id="playlistSelect">
          ${playlists
                .map(
                    (pl) =>
                        `<option value="${pl.id}">${pl.snippet.title}</option>`
                )
                .join('')
            }
        </select>
        <br/>
        <button id="downloadBtn">download playlist</button>
      </div>

      <script>
        // when the button is clicked, we'll navigate to /download-playlist?playlistId=...
        const downloadBtn = document.querySelector('#downloadBtn');
        const select = document.querySelector('#playlistSelect');

        downloadBtn.addEventListener('click', () => {
          const chosenId = select.value;
          if (!chosenId) {
            alert('no playlist selected!');
            return;
          }
          window.location.href = '/download-playlist?playlistId=' + chosenId;
        });
      </script>
    </body>
    </html>
    `;
        res.send(html);
    } catch (err) {
        console.error('error fetching playlists:', err);
        res.status(500).send('error fetching playlists.');
    }
});

/**
 * called when the user has selected a playlist from the popup
 * fetch all items, write them to a json file, and update the status
 */
app.get('/download-playlist', async (req, res) => {
    try {
        if (!oauth2Client.credentials || !oauth2Client.credentials.access_token) {
            return res
                .status(401)
                .send('error: oauth2 client not authorized. go to /auth first.');
        }

        const { playlistId } = req.query;
        if (!playlistId) {
            return res
                .status(400)
                .send('missing playlist id. please choose a playlist.');
        }

        // set status to in-progress
        downloadStatus = 'in-progress';

        // fetch the playlist items
        const items = await getPlaylistItems(playlistId, oauth2Client);

        // create a data folder if it doesn't exist
        const dataDir = path.join(process.cwd(), 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir);
        }

        const outFile = path.join(dataDir, `playlist_${playlistId}.json`);

        fs.writeFileSync(outFile, JSON.stringify(items, null, 2), 'utf8');

        downloadStatus = 'completed';

        res.send(`
      <html>
      <head><title>download complete</title></head>
      <body>
        <h1>download complete!</h1>
        <p>downloaded ${items.length} items to <strong>${outFile}</strong></p>
        <p><a href="/status" target="_blank">check status</a></p>
        <script>window.close()</script>
      </body>
      </html>
    `);
    } catch (err) {
        console.error('error downloading playlist:', err);
        downloadStatus = 'error';
        res.status(500).send('error downloading playlist.');
    }
});


app.get('/status', (_req, res) => {
    let html = `
    <html>
    <head>
      <title>download status</title>
    </head>
    <body>
      <h1>current status: ${downloadStatus}</h1>
    </body>
    </html>
  `;
    res.send(html);
});


//#endregion


app.listen(port, () => {
    console.log(`server listening on http://localhost:${port}`);
    console.log(`go to http://localhost:${port}/auth to start oauth flow`);
});
