// Vercel serverless function entry point
// This file bundles the entire Express app for serverless deployment

import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";

// Import server modules
import { registerRoutes } from "../server/routes.js";
import { log } from "../server/index.js";

const app = express();

// Only create httpServer if not in serverless mode
const httpServer: ReturnType<typeof createServer> | null = process.env.VERCEL ? null : createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
});

// Initialize the app
let appInitialized = false;
let initializationPromise: Promise<void> | null = null;

async function initializeApp() {
  console.log("[INIT] Starting app initialization...");
  console.log("[INIT] Environment:", {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: !!process.env.VERCEL,
    hasClientId: !!process.env.SPOTIFY_CLIENT_ID,
    hasClientSecret: !!process.env.SPOTIFY_CLIENT_SECRET,
    hasAdminPassword: !!process.env.ADMIN_PASSWORD
  });

  try {
    console.log("[INIT] Registering routes...");
    await registerRoutes(httpServer, app);
    console.log("[INIT] Routes registered successfully");

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      console.error("[EXPRESS ERROR]", {
        status,
        message,
        path: _req.path,
        method: _req.method,
        stack: err.stack
      });

      if (!res.headersSent) {
        res.status(status).json({ message });
      }
    });
    console.log("[INIT] Error handler registered");
  } catch (error: any) {
    console.error("[INIT] Initialization error:", {
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Vercel serverless function handler
export default async function handler(req: any, res: any) {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`[${requestId}] Serverless function called:`, {
    method: req.method,
    url: req.url,
    path: req.path || req.url?.split('?')[0],
    query: req.query,
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']?.substring(0, 50)
    },
    hasBody: !!req.body,
    bodyKeys: req.body ? Object.keys(req.body) : []
  });

  try {
    // Ensure initialization happens only once
    if (!appInitialized) {
      console.log(`[${requestId}] App not initialized, starting initialization...`);
      if (!initializationPromise) {
        console.log(`[${requestId}] Creating initialization promise...`);
        initializationPromise = initializeApp().catch((err) => {
          console.error(`[${requestId}] Failed to initialize app:`, err);
          console.error(`[${requestId}] Error stack:`, err?.stack);
          throw err;
        });
      }
      console.log(`[${requestId}] Waiting for initialization...`);
      await initializationPromise;
      appInitialized = true;
      console.log(`[${requestId}] App initialized successfully`);
    } else {
      console.log(`[${requestId}] App already initialized`);
    }
    
    console.log(`[${requestId}] Calling Express app...`);
    // Call Express app with Vercel's request/response
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error(`[${requestId}] Request timeout after 25 seconds`);
        reject(new Error("Request timeout"));
      }, 25000);

      res.on('finish', () => {
        clearTimeout(timeout);
        console.log(`[${requestId}] Response finished:`, {
          statusCode: res.statusCode,
          headersSent: res.headersSent,
          duration: Date.now() - startTime
        });
        resolve(true);
      });

      res.on('error', (err: any) => {
        clearTimeout(timeout);
        console.error(`[${requestId}] Response error:`, err);
        reject(err);
      });

      try {
        app(req, res);
      } catch (err) {
        clearTimeout(timeout);
        console.error(`[${requestId}] Express app error:`, err);
        reject(err);
      }
    });

    return result;
  } catch (error: any) {
    console.error(`[${requestId}] Serverless function error:`, {
      message: error?.message,
      stack: error?.stack,
      name: error?.name,
      duration: Date.now() - startTime
    });
    if (!res.headersSent) {
      console.log(`[${requestId}] Sending error response (headers not sent)`);
      res.status(500).json({ 
        error: "Internal server error",
        message: error?.message || "Unknown error",
        requestId
      });
    } else {
      console.log(`[${requestId}] Headers already sent, cannot send error response`);
    }
  }
}
