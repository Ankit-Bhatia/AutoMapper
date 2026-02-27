/**
 * oauthRoutes — OAuth authentication flows and session management.
 *
 * Currently implements Salesforce Web Server Flow (OAuth 2.0 Authorization Code Grant).
 * Credentials are stored per user per connector in the session store.
 *
 * Endpoints:
 *   GET    /api/oauth/salesforce/authorize     Initiate Salesforce OAuth flow
 *   GET    /api/oauth/salesforce/callback      Handle OAuth callback (exchanges code for token)
 *   DELETE /api/oauth/salesforce/disconnect    Clear stored Salesforce credentials
 *   GET    /api/oauth/status                   Get connection status for user's systems
 */

import type { Express, Request, Response } from 'express';
import { authMiddleware } from '../auth/authMiddleware.js';
import { defaultSessionStore } from '../services/connectorSessionStore.js';

/**
 * Setup OAuth routes for the application.
 * @param app - Express app instance
 * @param sessionStore - connector session store for credential storage
 */
export function setupOAuthRoutes(app: Express, sessionStore = defaultSessionStore): void {
  // ─── GET /api/oauth/salesforce/authorize ──────────────────────────────────────
  // Requires authentication. Redirects to Salesforce login with state parameter.
  app.get('/api/oauth/salesforce/authorize', authMiddleware, (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated' } });
      return;
    }

    const clientId = process.env.SF_APP_CLIENT_ID;
    const redirectUri = process.env.SF_APP_REDIRECT_URI || 'http://localhost:4000/api/oauth/salesforce/callback';
    const loginUrl = process.env.SF_APP_LOGIN_URL || 'https://login.salesforce.com';

    if (!clientId) {
      res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'SF_APP_CLIENT_ID not configured' } });
      return;
    }

    // Encode userId in state as base64
    const state = Buffer.from(userId).toString('base64');

    // Build Salesforce OAuth authorization URL
    const authUrl = new URL(`${loginUrl}/services/oauth2/authorize`);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('scope', 'api refresh_token');

    res.redirect(authUrl.toString());
  });

  // ─── GET /api/oauth/salesforce/callback ───────────────────────────────────────
  // Public endpoint. Handles OAuth callback, exchanges code for token.
  app.get('/api/oauth/salesforce/callback', async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query as Record<string, string>;

    if (error) {
      res.status(400).json({
        error: { code: error, message: error_description || 'OAuth authorization failed' },
      });
      return;
    }

    if (!code || !state) {
      res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Missing code or state parameter' },
      });
      return;
    }

    // Decode userId from state
    let userId: string;
    try {
      userId = Buffer.from(state, 'base64').toString('utf-8');
    } catch {
      res.status(400).json({
        error: { code: 'INVALID_STATE', message: 'Invalid state parameter' },
      });
      return;
    }

    const clientId = process.env.SF_APP_CLIENT_ID;
    const clientSecret = process.env.SF_APP_CLIENT_SECRET;
    const redirectUri = process.env.SF_APP_REDIRECT_URI || 'http://localhost:4000/api/oauth/salesforce/callback';
    const loginUrl = process.env.SF_APP_LOGIN_URL || 'https://login.salesforce.com';

    if (!clientId || !clientSecret) {
      res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'OAuth credentials not configured' } });
      return;
    }

    try {
      // Exchange code for token
      const tokenUrl = `${loginUrl}/services/oauth2/token`;
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorData = await response.text();
        res.status(400).json({
          error: { code: 'TOKEN_EXCHANGE_FAILED', message: `Salesforce token exchange failed: ${errorData}` },
        });
        return;
      }

      interface TokenResponse {
        access_token: string;
        instance_url: string;
        refresh_token?: string;
      }
      const data = (await response.json()) as TokenResponse;

      // Store credentials in session store
      sessionStore.set(userId, 'salesforce', {
        accessToken: data.access_token,
        instanceUrl: data.instance_url,
        refreshToken: data.refresh_token || '',
      });

      // Redirect to frontend with success flag
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/?sf_connected=true`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during token exchange';
      res.status(500).json({
        error: { code: 'SERVER_ERROR', message },
      });
    }
  });

  // ─── DELETE /api/oauth/salesforce/disconnect ──────────────────────────────────
  // Requires authentication. Clears stored Salesforce credentials for the user.
  app.delete('/api/oauth/salesforce/disconnect', authMiddleware, (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated' } });
      return;
    }

    sessionStore.clear(userId, 'salesforce');
    res.json({ message: 'Salesforce credentials cleared', disconnected: true });
  });

  // ─── GET /api/oauth/status ────────────────────────────────────────────────────
  // Requires authentication. Returns connection status for all systems.
  app.get('/api/oauth/status', authMiddleware, (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User not authenticated' } });
      return;
    }

    const systems = sessionStore.connectedSystems(userId);
    const statusMap = sessionStore.status(userId);

    res.json({
      connected: systems.length > 0,
      systems,
      status: statusMap,
    });
  });
}
