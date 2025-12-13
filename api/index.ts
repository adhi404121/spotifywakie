// Vercel serverless function entry point
import { app, initializeApp } from "../server/index";

// Initialize the app for serverless
let appInitialized = false;
let initializationPromise: Promise<void> | null = null;

export default async function handler(req: any, res: any) {
  try {
    // Ensure initialization happens only once, even with concurrent requests
    if (!appInitialized) {
      if (!initializationPromise) {
        initializationPromise = initializeApp().catch((err) => {
          console.error("Failed to initialize app:", err);
          throw err;
        });
      }
      await initializationPromise;
      appInitialized = true;
    }
    
    // Call Express app with Vercel's request/response
    return app(req, res);
  } catch (error: any) {
    console.error("Serverless function error:", error);
    // Only send response if headers haven't been sent
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Internal server error",
        message: error?.message || "Unknown error"
      });
    }
  }
}

