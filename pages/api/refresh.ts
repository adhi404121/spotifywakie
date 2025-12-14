import type { NextApiRequest, NextApiResponse } from "next";

// This handler assumes you're using Next.js API routes.
// If you use Express or another server, create an equivalent POST /api/refresh endpoint.

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
  const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN; // or fetch per-user from DB

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !REFRESH_TOKEN) {
    return res.status(500).json({ error: "Server not configured for refresh" });
  }

  const body = new URLSearchParams();
  body.append("grant_type", "refresh_token");
  body.append("refresh_token", REFRESH_TOKEN);

  const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");

  try {
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      const txt = await tokenRes.text();
      return res.status(500).json({ error: "Failed to refresh", details: txt });
    }

    const tokenData = await tokenRes.json();
    // tokenData: { access_token, token_type, scope, expires_in, refresh_token? }
    return res.status(200).json(tokenData);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error refreshing token" });
  }
}
