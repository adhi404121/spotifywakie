import { useEffect } from "react";
import { useLocation } from "wouter";

export default function Callback() {
  const [_, setLocation] = useLocation();

  useEffect(() => {
    // Handle Spotify Auth Redirect
    const hash = window.location.hash;
    const search = window.location.search;
    
    let token = null;

    if (hash) {
      const params = new URLSearchParams(hash.substring(1));
      token = params.get("access_token");
    } else if (search) {
       // Code flow would happen here, but for frontend-only, we usually use implicit or PKCE. 
       // If the user used the provided backend code, it would return a token.
       // Since we are frontend only, we might be getting a code that we can't exchange without CORS issues using the Secret.
       // However, let's try to grab whatever we can.
       const params = new URLSearchParams(search);
       const code = params.get("code");
       if (code) {
         // In a real app, we'd exchange this code for a token.
         // Without a backend, this stops here.
         console.log("Code received:", code);
       }
    }

    if (token) {
      localStorage.setItem("spotify_access_token", token);
      setLocation("/");
    } else {
        // Fallback for now to just go home
        setLocation("/");
    }
  }, [setLocation]);

  return (
    <div className="min-h-screen bg-[#121212] flex items-center justify-center text-white">
      Connecting to Spotify...
    </div>
  );
}
