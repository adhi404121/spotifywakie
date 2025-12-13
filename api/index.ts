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
        initializationPromise = initializeApp();
      }
      await initializationPromise;
      appInitialized = true;
    }
    
    return app(req, res);
  } catch (error: any) {
    console.error("Serverless function error:", error);
    res.status(500).json({ 
      error: "Internal server error",
      message: error?.message || "Unknown error"
    });
  }
}

