import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, spotifyTokens } from "./storage.js";
import { log } from "./index.js";

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";

// Get valid access token (refresh if needed)
async function getValidServerToken(): Promise<string | null> {
  if (!spotifyTokens.getAccessToken()) {
    return null;
  }

  // Check if token needs refresh
  if (spotifyTokens.isTokenExpired()) {
    const refreshToken = spotifyTokens.getRefreshToken();
    if (!refreshToken) {
      return null;
    }

    try {
      log("Refreshing server Spotify token...", "spotify");
      const tokens = await refreshAccessToken(refreshToken);
      spotifyTokens.setTokens(
        tokens.access_token,
        tokens.refresh_token || refreshToken,
        tokens.expires_in || 3600
      );
      return tokens.access_token;
    } catch (error: any) {
      log(`Token refresh failed: ${error.message}`, "spotify");
      spotifyTokens.clearTokens();
      return null;
    }
  }

  return spotifyTokens.getAccessToken();
}

// Helper function to exchange authorization code for tokens
async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const authString = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authString}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error_description || error.error || "Token exchange failed");
  }

  return await response.json();
}

// Helper function to refresh access token
async function refreshAccessToken(refreshToken: string) {
  const authString = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authString}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error_description || error.error || "Token refresh failed");
  }

  return await response.json();
}

export async function registerRoutes(
  httpServer: Server | null,
  app: Express
): Promise<Server | null> {
  // Server-side Spotify OAuth token exchange endpoint (one-time setup)
  app.post("/api/spotify/token", async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    console.log(`[TOKEN-EXCHANGE-${requestId}] Token exchange request received`);
    
    try {
      console.log(`[TOKEN-EXCHANGE-${requestId}] Request body:`, {
        hasCode: !!req.body?.code,
        codeLength: req.body?.code?.length,
        hasRedirectUri: !!req.body?.redirectUri,
        redirectUri: req.body?.redirectUri
      });

      const { code, redirectUri } = req.body;

      if (!code || !redirectUri) {
        console.error(`[TOKEN-EXCHANGE-${requestId}] Missing required fields:`, {
          hasCode: !!code,
          hasRedirectUri: !!redirectUri
        });
        return res.status(400).json({ error: "Missing code or redirectUri" });
      }

      if (!CLIENT_ID || !CLIENT_SECRET) {
        console.error(`[TOKEN-EXCHANGE-${requestId}] Missing credentials:`, {
          hasClientId: !!CLIENT_ID,
          hasClientSecret: !!CLIENT_SECRET
        });
        log("ERROR: SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not configured", "spotify");
        return res.status(500).json({ error: "Server configuration error" });
      }

      // Normalize redirect URI - ensure it matches exactly what's in Spotify Console
      const normalizedRedirectUri = redirectUri.trim();
      console.log(`[TOKEN-EXCHANGE-${requestId}] Using redirect URI:`, normalizedRedirectUri);
      log(`Server token exchange - using redirect URI: ${normalizedRedirectUri}`, "spotify");

      console.log(`[TOKEN-EXCHANGE-${requestId}] Calling exchangeCodeForTokens...`);
      const tokens = await exchangeCodeForTokens(code, normalizedRedirectUri);
      console.log(`[TOKEN-EXCHANGE-${requestId}] Token exchange successful:`, {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in
      });

      // Store tokens server-side
      spotifyTokens.setTokens(
        tokens.access_token,
        tokens.refresh_token,
        tokens.expires_in || 3600
      );

      console.log(`[TOKEN-EXCHANGE-${requestId}] Tokens stored successfully`);
      log("Server Spotify tokens stored successfully", "spotify");

      res.json({
        success: true,
        message: "Server authenticated with Spotify successfully",
        expires_in: tokens.expires_in,
      });
      console.log(`[TOKEN-EXCHANGE-${requestId}] Response sent successfully`);
    } catch (error: any) {
      console.error(`[TOKEN-EXCHANGE-${requestId}] Error:`, {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      log(`Token exchange error: ${error.message}`, "spotify");
      const errorMessage = error.message || "Token exchange failed";
      if (errorMessage.includes("redirect_uri")) {
        console.error(`[TOKEN-EXCHANGE-${requestId}] Redirect URI mismatch detected`);
        log(`IMPORTANT: Redirect URI mismatch. Make sure '${req.body.redirectUri}' is exactly added in Spotify Developer Console`, "spotify");
      }
      if (!res.headersSent) {
        res.status(500).json({ error: errorMessage, requestId });
      }
    }
  });

  // Test endpoint to verify serverless function is working
  app.get("/api/test", (req, res) => {
    console.log("[TEST] Test endpoint called");
    res.json({ 
      message: "Serverless function is working!",
      timestamp: new Date().toISOString(),
      environment: {
        vercel: !!process.env.VERCEL,
        nodeEnv: process.env.NODE_ENV
      }
    });
  });

  // Check if server is authenticated
  app.get("/api/spotify/status", async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    console.log(`[STATUS-${requestId}] Status check request received`);
    
    try {
      console.log(`[STATUS-${requestId}] Getting valid server token...`);
      const token = await getValidServerToken();
      const hasToken = !!spotifyTokens.getAccessToken();
      const authenticated = !!token;
      
      console.log(`[STATUS-${requestId}] Status result:`, {
        authenticated,
        hasToken,
        hasValidToken: !!token
      });
      
      const response = {
        authenticated,
        hasToken
      };
      
      console.log(`[STATUS-${requestId}] Sending response:`, response);
      res.json(response);
      console.log(`[STATUS-${requestId}] Response sent successfully`);
    } catch (error: any) {
      console.error(`[STATUS-${requestId}] Error:`, {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      log(`Status endpoint error: ${error.message}`, "spotify");
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Failed to check authentication status",
          authenticated: false,
          hasToken: false,
          requestId
        });
      }
    }
  });

  // Add song to queue (no authentication required for users)
  app.post("/api/spotify/queue", async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    console.log(`[QUEUE-${requestId}] Queue request received:`, {
      hasSongName: !!req.body?.songName,
      songName: req.body?.songName,
      hasUri: !!req.body?.uri,
      uri: req.body?.uri
    });

    try {
      const { songName, uri } = req.body;

      if (!songName && !uri) {
        console.error(`[QUEUE-${requestId}] Missing songName or uri`);
        return res.status(400).json({ error: "Missing songName or uri" });
      }

      const accessToken = await getValidServerToken();
      if (!accessToken) {
        console.error(`[QUEUE-${requestId}] No valid access token`);
        return res.status(401).json({ 
          error: "Server not authenticated with Spotify. Please authenticate the server first." 
        });
      }

      let trackUri = uri;

      // If song name provided, search for it
      if (songName && !uri) {
        const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(songName)}&type=track&limit=1`;
        console.log(`[QUEUE-${requestId}] Searching for song:`, { songName, searchUrl });
        
        const searchRes = await fetch(searchUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        console.log(`[QUEUE-${requestId}] Search response:`, {
          status: searchRes.status,
          statusText: searchRes.statusText,
          ok: searchRes.ok
        });

        if (!searchRes.ok) {
          const errorText = await searchRes.text().catch(() => "Could not read error response");
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { raw: errorText };
          }
          
          console.error(`[QUEUE-${requestId}] Search failed:`, {
            status: searchRes.status,
            statusText: searchRes.statusText,
            error: errorData
          });
          
          const errorMessage = errorData.error?.message || errorData.error || errorText || "Search failed";
          log(`Queue search error: ${searchRes.status} ${searchRes.statusText} - ${errorMessage}`, "spotify");
          throw new Error(`Search failed: ${errorMessage}`);
        }

        const searchData = await searchRes.json();
        console.log(`[QUEUE-${requestId}] Search results:`, {
          totalResults: searchData.tracks?.total || 0,
          itemsFound: searchData.tracks?.items?.length || 0
        });

        if (!searchData.tracks?.items?.length) {
          console.log(`[QUEUE-${requestId}] No tracks found for: ${songName}`);
          return res.status(404).json({ error: `Song not found: ${songName}` });
        }

        trackUri = searchData.tracks.items[0].uri;
        console.log(`[QUEUE-${requestId}] Found track URI:`, trackUri);
      }

      // Add to queue
      const queueUrl = `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(trackUri)}`;
      console.log(`[QUEUE-${requestId}] Adding to queue:`, { trackUri, queueUrl });
      
      const queueRes = await fetch(queueUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      console.log(`[QUEUE-${requestId}] Queue response:`, {
        status: queueRes.status,
        statusText: queueRes.statusText,
        ok: queueRes.ok
      });

      if (!queueRes.ok && queueRes.status !== 204) {
        const errorText = await queueRes.text().catch(() => "Could not read error response");
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { raw: errorText };
        }
        
        console.error(`[QUEUE-${requestId}] Queue add failed:`, {
          status: queueRes.status,
          statusText: queueRes.statusText,
          error: errorData
        });
        
        const errorMessage = errorData.error?.message || errorData.error || errorText || "Failed to add song to queue";
        log(`Queue add error: ${queueRes.status} ${queueRes.statusText} - ${errorMessage}`, "spotify");
        throw new Error(`Failed to add song to queue: ${errorMessage}`);
      }

      console.log(`[QUEUE-${requestId}] Successfully added to queue`);
      res.json({ success: true, message: "Song added to queue" });
    } catch (error: any) {
      console.error(`[QUEUE-${requestId}] Queue endpoint error:`, {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      log(`Queue error: ${error.message}`, "spotify");
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Failed to add song" });
      }
    }
  });

  // Control playback (admin only - requires password)
  app.post("/api/spotify/control", async (req, res) => {
    try {
      const { action, volume } = req.body;
      const { password } = req.headers;

      // Password check - must be set in environment variables
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
      if (!ADMIN_PASSWORD) {
        log("ERROR: ADMIN_PASSWORD not configured", "spotify");
        return res.status(500).json({ error: "Server configuration error: Admin password not set" });
      }
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const accessToken = await getValidServerToken();
      if (!accessToken) {
        return res.status(401).json({ 
          error: "Server not authenticated with Spotify" 
        });
      }

      let response;
      switch (action) {
        case "play":
          response = await fetch("https://api.spotify.com/v1/me/player/play", {
            method: "PUT",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          break;
        case "pause":
          response = await fetch("https://api.spotify.com/v1/me/player/pause", {
            method: "PUT",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          break;
        case "next":
          response = await fetch("https://api.spotify.com/v1/me/player/next", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          break;
        case "volume":
          if (volume === undefined) {
            return res.status(400).json({ error: "Volume value required" });
          }
          response = await fetch(
            `https://api.spotify.com/v1/me/player/volume?volume_percent=${volume}`,
            {
              method: "PUT",
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );
          break;
        default:
          return res.status(400).json({ error: "Invalid action" });
      }

      if (!response.ok && response.status !== 204) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || "Control action failed");
      }

      res.json({ success: true, message: `Action ${action} completed` });
    } catch (error: any) {
      log(`Control error: ${error.message}`, "spotify");
      res.status(500).json({ error: error.message || "Control action failed" });
    }
  });

  // Get currently playing (no auth required)
  app.get("/api/spotify/now-playing", async (req, res) => {
    try {
      const accessToken = await getValidServerToken();
      if (!accessToken) {
        return res.json({ playing: false, track: null });
      }

      const response = await fetch(
        "https://api.spotify.com/v1/me/player/currently-playing",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (response.status === 204) {
        return res.json({ playing: false, track: null });
      }

      if (!response.ok) {
        return res.json({ playing: false, track: null });
      }

      const data = await response.json();
      res.json({
        playing: data.is_playing || false,
        track: data.item
          ? {
              name: data.item.name,
              artist: data.item.artists.map((a: any) => a.name).join(", "),
              image: data.item.album.images[0]?.url,
            }
          : null,
      });
    } catch (error: any) {
      log(`Now playing error: ${error.message}`, "spotify");
      res.json({ playing: false, track: null });
    }
  });

  return httpServer || null;
}
