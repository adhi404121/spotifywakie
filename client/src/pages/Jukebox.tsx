import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, SkipForward, Volume2, Volume1, Plus, Music2, Lock, Unlock, LogIn } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// Configuration
const CLIENT_ID = "05ac566290dc43a6b8836c57cb41d440";
const REDIRECT_URI = window.location.hostname === "localhost" 
  ? "http://localhost:5000/" 
  : "https://spotifywakiee.vercel.app/";
// Note: We use Implicit Grant (Client ID only) for frontend-only apps. 
// Client Secret is NOT used here as it cannot be safely exposed in the browser.

const SCOPES = [
  "user-modify-playback-state",
  "user-read-playback-state",
  "user-read-currently-playing"
];

const ADMIN_PASSWORD = "A";

export default function Jukebox() {
  const { toast } = useToast();
  const [songInput, setSongInput] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null);
  
  // State for UI
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState([50]);
  const [currentTrack, setCurrentTrack] = useState({
    name: "Ready to Play",
    artist: "Queue a song to start",
    image: null
  });

  useEffect(() => {
    const checkAuth = () => {
      // 1. Check URL Hash for Token (Redirect back from Spotify)
      const hash = window.location.hash;
      if (hash && hash.includes("access_token")) {
        console.log("Found token in hash");
        const params = new URLSearchParams(hash.substring(1));
        const token = params.get("access_token");
        if (token) {
          localStorage.setItem("spotify_access_token", token);
          setSpotifyToken(token);
          setIsAuthenticated(true);
          fetchNowPlaying(token);
          
          // Clear hash cleanly without reload
          window.history.pushState("", document.title, window.location.pathname + window.location.search);
          
          toast({
              title: "Spotify Connected Successfully",
              description: "Token retrieved and saved.",
              className: "text-spotify-green border-spotify-green",
          });
          return;
        }
      }

      // 2. Check LocalStorage if no hash token
      const storedToken = localStorage.getItem("spotify_access_token");
      if (storedToken) {
        console.log("Found token in localStorage");
        setSpotifyToken(storedToken);
        setIsAuthenticated(true); // Auto-admin if token exists
        fetchNowPlaying(storedToken);
      }
    };

    checkAuth();
    
    // Polling interval
    const interval = setInterval(() => {
      const token = localStorage.getItem("spotify_access_token");
      if (token) fetchNowPlaying(token);
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);

  const handleLogin = () => {
    // Implicit Grant Flow
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES.join(" "))}&response_type=token&show_dialog=true`;
    window.location.href = authUrl;
  };

  const fetchNowPlaying = async (token: string) => {
    try {
      const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (res.status === 401) {
        // Token expired
        setSpotifyToken(null);
        localStorage.removeItem("spotify_access_token");
        toast({ title: "Session Expired", description: "Please Authenticate Jukebox again.", variant: "destructive" });
        return;
      }

      if (res.status === 204 || res.status > 400) return;
      
      const data = await res.json();
      if (data && data.item) {
        setCurrentTrack({
          name: data.item.name,
          artist: data.item.artists.map((a: any) => a.name).join(", "),
          image: data.item.album.images[0]?.url
        });
        setIsPlaying(data.is_playing);
      }
    } catch (e) {
      console.error("Error fetching now playing", e);
    }
  };

  const spotifyApiCall = async (endpoint: string, method: string = "POST", body?: any) => {
    if (!spotifyToken) {
      toast({ title: "Not Connected", description: "Please login to Spotify first.", variant: "destructive" });
      return;
    }

    try {
      const res = await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, {
        method,
        headers: { 
          Authorization: `Bearer ${spotifyToken}`,
          "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
      });

      if (res.ok) {
        toast({ title: "Success", className: "text-spotify-green border-spotify-green" });
        setTimeout(() => fetchNowPlaying(spotifyToken), 500); // Refresh state
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error?.message || "Command failed", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Network Error", variant: "destructive" });
    }
  };

  const handleQueueSong = async () => {
    if (!songInput.trim()) return;

    // Determine if URI or Search
    let uri = songInput.trim();
    if (!uri.startsWith("spotify:track:")) {
      // Basic search to get URI (requires token)
       if (spotifyToken) {
         const searchRes = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(songInput)}&type=track&limit=1`, {
            headers: { Authorization: `Bearer ${spotifyToken}` }
         });
         const searchData = await searchRes.json();
         if (searchData.tracks.items.length > 0) {
           uri = searchData.tracks.items[0].uri;
           toast({ description: `Found: ${searchData.tracks.items[0].name}` });
         } else {
           toast({ title: "Not Found", variant: "destructive" });
           return;
         }
       } else {
          toast({ title: "Login Required", description: "Admin must login to search songs.", variant: "destructive" });
          return;
       }
    }

    await spotifyApiCall(`queue?uri=${uri}`);
    setSongInput("");
  };

  const executeAdminAction = (action: () => void) => {
    if (isAuthenticated) {
      action();
    } else {
      setPendingAction(() => action);
      setShowPasswordPrompt(true);
    }
  };

  const handlePasswordSubmit = () => {
    if (passwordInput === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
      setShowPasswordPrompt(false);
      setPasswordInput("");
      toast({
        title: "Admin Access Granted",
        description: "You now have control over playback.",
        className: "text-spotify-green border-spotify-green",
      });
      if (pendingAction) {
        pendingAction();
        setPendingAction(null);
      }
    } else {
      toast({
        title: "Access Denied",
        description: "Incorrect password.",
        variant: "destructive",
      });
      setPasswordInput("");
    }
  };

  return (
    <div className="min-h-screen bg-[#121212] flex items-center justify-center p-4 overflow-hidden relative">
      {/* Animated Background Rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
        <div className="relative w-[350px] h-[350px] md:w-[500px] md:h-[500px] flex items-center justify-center">
          {/* Ring 1 - Green */}
          <div 
            className="absolute inset-0 border-[5px] border-[#1DB954] rounded-[38%_62%_63%_37%/41%_44%_56%_59%] animate-ring shadow-[0_0_20px_#1DB954]"
            style={{ opacity: 0.8 }}
          ></div>
          
          {/* Ring 2 - Red/Accent */}
          <div 
            className="absolute inset-0 border-[5px] border-[#FF6E6E] rounded-[41%_44%_56%_59%/38%_62%_63%_37%] animate-ring-reverse shadow-[0_0_20px_#FF6E6E]"
            style={{ transform: 'scale(1.05)', opacity: 0.6 }}
          ></div>
        </div>
      </div>

      {/* Controller Box */}
      <Card className="relative w-full max-w-md bg-[#121212]/80 backdrop-blur-xl border-white/5 p-6 md:p-8 rounded-2xl shadow-2xl z-10">
        
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-display font-bold text-[#1DB954] tracking-tight mb-2 flex items-center justify-center gap-2">
            <Music2 className="w-8 h-8" />
            KARIVEPPILA JUKEBOX
          </h1>
          <p className="text-zinc-400 text-sm">
            {currentTrack.name === "Ready to Play" ? "Queue is empty" : "Now Playing"}
          </p>
        </div>

        {/* Now Playing Info */}
        <div className="mb-8 text-center flex flex-col items-center">
           {currentTrack.image && (
             <img src={currentTrack.image} alt="Album Art" className="w-32 h-32 rounded-lg mb-4 shadow-lg" />
           )}
           <div className="text-xl font-medium text-white mb-1 truncate w-full px-4">{currentTrack.name}</div>
           <div className="text-zinc-500 text-sm">{currentTrack.artist}</div>
        </div>

        {/* Song Input */}
        <div className="space-y-4 mb-8">
          <div className="flex gap-2">
            <Input 
              type="text" 
              placeholder="Song Name or Spotify URI..."
              className="bg-[#282828] border-[#333] text-white placeholder:text-zinc-500 focus-visible:ring-[#1DB954]"
              value={songInput}
              onChange={(e) => setSongInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleQueueSong()}
            />
            <Button 
              onClick={handleQueueSong}
              className="bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold shrink-0"
            >
              <Plus className="w-5 h-5 mr-1" />
              Add
            </Button>
          </div>
        </div>

        <div className="h-px bg-white/10 w-full mb-6"></div>

        {/* Admin Controls Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1">
              {isAuthenticated ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              Admin Controls
            </p>
            {/* If authenticated as admin but no token, show connect button */}
            {!spotifyToken && isAuthenticated && (
               <Button 
                 size="sm" 
                 onClick={handleLogin} 
                 className="bg-[#1DB954] text-black hover:bg-[#1ed760] text-xs h-7 font-bold animate-pulse"
               >
                 <LogIn className="w-3 h-3 mr-1" /> Authenticate Jukebox
               </Button>
            )}
             {/* If connected, show small status */}
            {spotifyToken && (
               <span className="text-[10px] text-spotify-green flex items-center gap-1">
                 <div className="w-1.5 h-1.5 rounded-full bg-spotify-green animate-pulse"></div>
                 Live
               </span>
            )}
          </div>

          <div className="grid grid-cols-4 gap-3">
            <Button
              variant="secondary"
              className="h-14 bg-[#282828] hover:bg-[#3E3E3E] border-0 text-white"
              onClick={() => executeAdminAction(() => {
                if(isPlaying) spotifyApiCall("pause", "PUT");
                else spotifyApiCall("play", "PUT");
              })}
            >
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </Button>

            <Button
              variant="secondary"
              className="h-14 bg-[#282828] hover:bg-[#3E3E3E] border-0 text-white"
              onClick={() => executeAdminAction(() => spotifyApiCall("next", "POST"))}
            >
              <SkipForward className="w-6 h-6" />
            </Button>

            <div className="col-span-2 bg-[#282828] rounded-md px-3 flex items-center gap-2">
              <Volume1 className="w-4 h-4 text-zinc-400" />
              <Slider 
                value={volume} 
                onValueChange={(val) => {
                   setVolume(val);
                   executeAdminAction(() => spotifyApiCall(`volume?volume_percent=${val[0]}`, "PUT"));
                }}
                max={100} 
                step={1}
                className="cursor-pointer" 
              />
              <Volume2 className="w-4 h-4 text-zinc-400" />
            </div>
          </div>
        </div>
      </Card>

      {/* Password Prompt Modal */}
      <Dialog open={showPasswordPrompt} onOpenChange={setShowPasswordPrompt}>
        <DialogContent className="bg-[#121212] border-[#FF6E6E] text-white sm:max-w-xs shadow-[0_0_30px_rgba(255,110,110,0.3)]">
          <DialogHeader>
            <DialogTitle className="text-[#FF6E6E]">Admin Access</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Enter password to control playback.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              type="password"
              placeholder="Admin Password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
              className="bg-[#282828] border-[#333] text-white focus-visible:ring-[#FF6E6E]"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button 
              onClick={handlePasswordSubmit}
              className="bg-[#FF6E6E] hover:bg-[#ff8585] text-black font-bold w-full"
            >
              Unlock Controls
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
