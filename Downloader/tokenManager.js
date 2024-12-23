import fs from 'fs';
import { google } from 'googleapis';


export class tokenManager {
    constructor({
        clientId,
        clientSecret,
        redirectUri,
        tokenPath = 'token.json'
    }) {
        // store options
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
        this.tokenPath = tokenPath;

        // create oauth2 client
        this.oauth2Client = new google.auth.OAuth2(
            this.clientId,
            this.clientSecret,
            this.redirectUri
        );
    }

    loadToken() {
        if (!fs.existsSync(this.tokenPath)) {
            return null;
        }

        const tokenData = fs.readFileSync(this.tokenPath, 'utf-8');
        const token = JSON.parse(tokenData);
        this.oauth2Client.setCredentials(token);

        return token;
    }

    
    saveToken(token) {
        fs.writeFileSync(this.tokenPath, JSON.stringify(token, null, 2), 'utf-8');
        this.oauth2Client.setCredentials(token);
    }

    async refreshAccessToken() {
        // if no refresh token is present, we can't refresh
        if (!this.oauth2Client.credentials.refresh_token) {
            throw new Error('no refresh token is available');
        }

        // use the googleapis refresh method
        const { credentials } = await this.oauth2Client.refreshAccessToken();

        // save the new token info
        this.saveToken(credentials);
        return credentials;
    }

    getAuthClient() {
        return this.oauth2Client;
    }
}
