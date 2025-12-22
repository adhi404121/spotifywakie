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

  // Check if token needs refresh (refresh 5 minutes before expiration)
  if (spotifyTokens.isTokenExpired()) {
    const refreshToken = spotifyTokens.getRefreshToken();
    if (!refreshToken) {
      log("No refresh token available", "spotify");
      return null;
    }

    try {
      log("Refreshing server Spotify token...", "spotify");
      console.log("[TOKEN-REFRESH] Attempting token refresh...");
      const tokens = await refreshAccessToken(refreshToken);
      
      console.log("[TOKEN-REFRESH] Token refresh successful:", {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in
      });
      
      spotifyTokens.setTokens(
        tokens.access_token,
        tokens.refresh_token || refreshToken,
        tokens.expires_in || 3600
      );
      log("Token refreshed successfully", "spotify");
      return tokens.access_token;
    } catch (error: any) {
      console.error("[TOKEN-REFRESH] Token refresh failed:", {
        message: error.message,
        stack: error.stack
      });
      log(`Token refresh failed: ${error.message}`, "spotify");
      spotifyTokens.clearTokens();
      return null;
    }
  }

  return spotifyTokens.getAccessToken();
}

// Helper to make Spotify API calls with automatic token refresh on 401
async function spotifyApiCall(
  url: string,
  options: RequestInit = {},
  retryOn401 = true
): Promise<Response> {
  let accessToken = await getValidServerToken();
  if (!accessToken) {
    throw new Error("No valid access token available");
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  // If 401 and retry enabled, try refreshing token once
  if (response.status === 401 && retryOn401) {
    console.log("[SPOTIFY-API] Got 401, attempting token refresh and retry...");
    const refreshToken = spotifyTokens.getRefreshToken();
    if (refreshToken) {
      try {
        const tokens = await refreshAccessToken(refreshToken);
        spotifyTokens.setTokens(
          tokens.access_token,
          tokens.refresh_token || refreshToken,
          tokens.expires_in || 3600
        );
        
        // Retry with new token
        accessToken = tokens.access_token;
        return await fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${accessToken}`,
          },
        });
      } catch (error: any) {
        console.error("[SPOTIFY-API] Token refresh on 401 failed:", error.message);
        throw new Error("Authentication failed: Token refresh unsuccessful");
      }
    }
  }

  return response;
}

// Helper function to exchange authorization code for tokens
async function exchangeCodeForTokens(code: string, redirectUri: string) {
  // Validate credentials before making request
  if (!CLIENT_ID || !CLIENT_SECRET) {
    const missing = [];
    if (!CLIENT_ID) missing.push("CLIENT_ID");
    if (!CLIENT_SECRET) missing.push("CLIENT_SECRET");
    throw new Error(`Missing credentials: ${missing.join(", ")}`);
  }

  const authString = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  
  console.log("[TOKEN-EXCHANGE] Making token request to Spotify:", {
    hasClientId: !!CLIENT_ID,
    clientIdLength: CLIENT_ID.length,
    hasClientSecret: !!CLIENT_SECRET,
    clientSecretLength: CLIENT_SECRET.length,
    redirectUri,
    codeLength: code.length
  });

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

  console.log("[TOKEN-EXCHANGE] Spotify response:", {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Could not read error response");
    let errorData;
    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { raw: errorText };
    }
    
    console.error("[TOKEN-EXCHANGE] Spotify API error:", {
      status: response.status,
      statusText: response.statusText,
      error: errorData
    });
    
    const errorMessage = errorData.error_description || errorData.error || errorText || "Token exchange failed";
    throw new Error(errorMessage);
  }

  return await response.json();
}

// Helper function to refresh access token
async function refreshAccessToken(refreshToken: string) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("CLIENT_ID or CLIENT_SECRET not configured");
  }

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
    const errorText = await response.text().catch(() => "Could not read error response");
    let errorData;
    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { raw: errorText };
    }
    
    console.error("[TOKEN-REFRESH] Spotify API error:", {
      status: response.status,
      statusText: response.statusText,
      error: errorData
    });
    
    const errorMessage = errorData.error_description || errorData.error || errorText || "Token refresh failed";
    throw new Error(errorMessage);
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
          clientIdLength: CLIENT_ID?.length || 0,
          hasClientSecret: !!CLIENT_SECRET,
          clientSecretLength: CLIENT_SECRET?.length || 0,
          envClientId: !!process.env.SPOTIFY_CLIENT_ID,
          envClientSecret: !!process.env.SPOTIFY_CLIENT_SECRET,
          envClientIdLength: process.env.SPOTIFY_CLIENT_ID?.length || 0,
          envClientSecretLength: process.env.SPOTIFY_CLIENT_SECRET?.length || 0
        });
        log("ERROR: SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not configured", "spotify");
        return res.status(500).json({ error: "Server configuration error: Missing CLIENT_ID or CLIENT_SECRET" });
      }

      console.log(`[TOKEN-EXCHANGE-${requestId}] Credentials check passed:`, {
        hasClientId: !!CLIENT_ID,
        clientIdLength: CLIENT_ID.length,
        clientIdPrefix: CLIENT_ID.substring(0, 8) + "...",
        hasClientSecret: !!CLIENT_SECRET,
        clientSecretLength: CLIENT_SECRET.length,
        clientSecretPrefix: CLIENT_SECRET.substring(0, 8) + "..."
      });

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
        
        const searchRes = await spotifyApiCall(searchUrl);

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
      
      const queueRes = await spotifyApiCall(queueUrl, { method: "POST" });

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

      let response;
      switch (action) {
        case "play":
          response = await spotifyApiCall("https://api.spotify.com/v1/me/player/play", {
            method: "PUT",
          });
          break;
        case "pause":
          response = await spotifyApiCall("https://api.spotify.com/v1/me/player/pause", {
            method: "PUT",
          });
          break;
        case "next":
          response = await spotifyApiCall("https://api.spotify.com/v1/me/player/next", {
            method: "POST",
          });
          break;
        case "volume":
          if (volume === undefined) {
            return res.status(400).json({ error: "Volume value required" });
          }
          response = await spotifyApiCall(
            `https://api.spotify.com/v1/me/player/volume?volume_percent=${volume}`,
            {
              method: "PUT",
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

  // Search suggestions endpoint (for autocomplete)
  app.get("/api/spotify/search", async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    try {
      const { q, limit = "10" } = req.query;

      if (!q || typeof q !== "string") {
        return res.status(400).json({ error: "Missing query parameter 'q'" });
      }

      const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=${Math.min(parseInt(limit as string) || 10, 20)}`;
      console.log(`[SEARCH-${requestId}] Search request:`, { q, limit, searchUrl });

      const searchRes = await spotifyApiCall(searchUrl);

      if (!searchRes.ok) {
        const errorText = await searchRes.text().catch(() => "Could not read error response");
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { raw: errorText };
        }
        
        console.error(`[SEARCH-${requestId}] Search failed:`, {
          status: searchRes.status,
          statusText: searchRes.statusText,
          error: errorData
        });
        
        return res.status(searchRes.status).json({ 
          error: errorData.error?.message || errorData.error || "Search failed" 
        });
      }

      const searchData = await searchRes.json();
      const tracks = (searchData.tracks?.items || []).map((track: any) => ({
        id: track.id,
        name: track.name,
        artist: track.artists.map((a: any) => a.name).join(", "),
        album: track.album.name,
        image: track.album.images[0]?.url,
        uri: track.uri,
        duration_ms: track.duration_ms,
      }));

      console.log(`[SEARCH-${requestId}] Search results:`, {
        total: searchData.tracks?.total || 0,
        returned: tracks.length
      });

      res.json({ tracks, total: searchData.tracks?.total || 0 });
    } catch (error: any) {
      console.error(`[SEARCH-${requestId}] Search endpoint error:`, {
        message: error.message,
        stack: error.stack
      });
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Search failed" });
      }
    }
  });

  // Get current queue (anyone can view)
  app.get("/api/spotify/queue", async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    try {
      const queueRes = await spotifyApiCall(
        "https://api.spotify.com/v1/me/player/queue",
        {},
        false
      );

      if (queueRes.status === 204 || !queueRes.ok) {
        return res.json({ queue: [], currently_playing: null });
      }

      const queueData = await queueRes.json();
      const queue = (queueData.queue || []).map((track: any) => ({
        id: track.id,
        name: track.name,
        artist: track.artists.map((a: any) => a.name).join(", "),
        album: track.album.name,
        image: track.album.images[0]?.url,
        uri: track.uri,
        duration_ms: track.duration_ms,
      }));

      const currentlyPlaying = queueData.currently_playing ? {
        id: queueData.currently_playing.id,
        name: queueData.currently_playing.name,
        artist: queueData.currently_playing.artists.map((a: any) => a.name).join(", "),
        album: queueData.currently_playing.album.name,
        image: queueData.currently_playing.album.images[0]?.url,
        uri: queueData.currently_playing.uri,
        duration_ms: queueData.currently_playing.duration_ms,
      } : null;

      res.json({ queue, currently_playing: currentlyPlaying });
    } catch (error: any) {
      console.error(`[QUEUE-GET-${requestId}] Error:`, error.message);
      if (!res.headersSent) {
        res.json({ queue: [], currently_playing: null });
      }
    }
  });

  // Remove from queue (admin only - requires password)
  app.delete("/api/spotify/queue", async (req, res) => {
    const requestId = Math.random().toString(36).substring(7);
    try {
      const { uri } = req.body;
      const { password } = req.headers;

      if (!uri) {
        return res.status(400).json({ error: "Missing uri parameter" });
      }

      // Password check - must be set in environment variables
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
      if (!ADMIN_PASSWORD) {
        log("ERROR: ADMIN_PASSWORD not configured", "spotify");
        return res.status(500).json({ error: "Server configuration error: Admin password not set" });
      }
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Unauthorized - Admin access required" });
      }

      // Note: Spotify API doesn't have a direct "remove from queue" endpoint
      // We'll need to skip to next track if it's the next one, or inform user
      // For now, we'll return an error explaining the limitation
      // In the future, we could implement a workaround by skipping tracks
      
      // Check if the track is next in queue
      const queueRes = await spotifyApiCall(
        "https://api.spotify.com/v1/me/player/queue",
        {},
        false
      );

      if (queueRes.ok) {
        const queueData = await queueRes.json();
        const nextTrack = queueData.queue?.[0];
        
        if (nextTrack && nextTrack.uri === uri) {
          // Skip to next track (removes current next from queue)
          await spotifyApiCall("https://api.spotify.com/v1/me/player/next", {
            method: "POST",
          });
          res.json({ success: true, message: "Track removed from queue" });
        } else {
          // Track is not next in queue - Spotify API limitation
          res.status(400).json({ 
            error: "Can only remove the next track in queue. Spotify API limitation." 
          });
        }
      } else {
        res.status(400).json({ error: "Unable to access queue" });
      }
    } catch (error: any) {
      console.error(`[QUEUE-DELETE-${requestId}] Error:`, error.message);
      log(`Queue remove error: ${error.message}`, "spotify");
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Failed to remove from queue" });
      }
    }
  });

  // Get currently playing (no auth required)
  app.get("/api/spotify/now-playing", async (req, res) => {
    try {
      const accessToken = await getValidServerToken();
      if (!accessToken) {
        return res.json({ playing: false, track: null });
      }

      try {
        const response = await spotifyApiCall(
          "https://api.spotify.com/v1/me/player/currently-playing",
          {},
          false // Don't retry on 401 for now-playing (it's okay if not playing)
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
      } catch (apiError: any) {
        // If it's a "no token" error, just return not playing
        if (apiError.message?.includes("No valid access token")) {
          return res.json({ playing: false, track: null });
        }
        throw apiError;
      }
    } catch (error: any) {
      log(`Now playing error: ${error.message}`, "spotify");
      res.json({ playing: false, track: null });
    }
  });

  return httpServer || null;
}
