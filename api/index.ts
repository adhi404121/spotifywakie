// Vercel serverless function entry point
import { app, initializeApp } from "../server/index";

// Initialize the app for serverless
let appInitialized = false;

export default async function handler(req: any, res: any) {
  if (!appInitialized) {
    await initializeApp();
    appInitialized = true;
  }
  return app(req, res);
}

