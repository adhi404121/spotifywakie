// Vercel serverless function entry point
import { app, initializeApp } from "../server/index";

// Initialize the app for serverless
let appInitialized = false;
let initializationPromise: Promise<void> | null = null;

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
    // Ensure initialization happens only once, even with concurrent requests
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
    // Only send response if headers haven't been sent
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

