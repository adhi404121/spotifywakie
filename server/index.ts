import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes.js";
import { serveStatic } from "./static.js";
import { createServer } from "http";

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

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

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

// Initialize the app (for both server and serverless)
export async function initializeApp() {
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

      // Don't throw after sending response - just log
      if (!res.headersSent) {
        res.status(status).json({ message });
      }
    });
    console.log("[INIT] Error handler registered");

    // Only setup static/vite for traditional server mode, not serverless
    if (!process.env.VERCEL) {
      // importantly only setup vite in development and after
      // setting up all the other routes so the catch-all route
      // doesn't interfere with the other routes
      if (process.env.NODE_ENV === "production") {
        serveStatic(app);
      } else {
        const { setupVite } = await import("./vite");
        if (httpServer) {
          await setupVite(httpServer, app);
        }
      }
    }
  } catch (error: any) {
    console.error("[INIT] Initialization error:", {
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Only start listening if not in serverless mode (Vercel)
if (!process.env.VERCEL) {
  (async () => {
    await initializeApp();

    // ALWAYS serve the app on the port specified in the environment variable PORT
    // Default to 8089 for local development
    // this serves both the API and the client.
    const port = parseInt(process.env.PORT || "8089", 10);
    const isWindows = process.platform === "win32";
    
    // Windows doesn't support reusePort option
    // Use 127.0.0.1 instead of localhost to avoid IPv6 binding issues
    const listenOptions = isWindows
      ? { port, host: "127.0.0.1" }
      : { port, host: "0.0.0.0", reusePort: true };
    
    if (httpServer) {
      httpServer.listen(listenOptions, () => {
        log(`serving on port ${port}`);
      }).on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EACCES" || err.code === "EADDRINUSE") {
          log(`Port ${port} is not available. Try a different port by setting PORT environment variable.`, "error");
          log(`Example: PORT=3001 npm run dev`, "error");
        }
        throw err;
      });
    }
  })();
}

// Export app for Vercel serverless functions
export { app };
