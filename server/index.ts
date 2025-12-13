import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

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
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
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
    
    httpServer.listen(listenOptions, () => {
      log(`serving on port ${port}`);
    }).on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EACCES" || err.code === "EADDRINUSE") {
        log(`Port ${port} is not available. Try a different port by setting PORT environment variable.`, "error");
        log(`Example: PORT=3001 npm run dev`, "error");
      }
      throw err;
    });
  })();
}

// Export app for Vercel serverless functions
export { app };
