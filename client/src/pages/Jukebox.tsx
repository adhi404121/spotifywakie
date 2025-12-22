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

// Configuration - Load from environment variables
const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || "";
const REDIRECT_URI = import.meta.env.VITE_SPOTIFY_REDIRECT_URI || "";
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || "";

// Using Authorization Code flow for automatic token refresh
const SCOPES = [
  "user-modify-playback-state",
  "user-read-playback-state",
  "user-read-currently-playing"
];

// Server-side authentication - no client-side token storage needed

interface SearchTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  image: string | null;
  uri: string;
  duration_ms: number;
}

export default function Jukebox() {
  const { toast } = useToast();
  const [songInput, setSongInput] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null); // Just a flag: "server-authenticated" or null
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [adminPassword, setAdminPassword] = useState<string | null>(null); // Store entered password
  
  // Search suggestions state
  const [searchSuggestions, setSearchSuggestions] = useState<SearchTrack[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  
  // State for UI
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState([50]);
  const [currentTrack, setCurrentTrack] = useState({
    name: "Ready to Play",
    artist: "Queue a song to start",
    image: null
  });

  useEffect(() => {
    console.log("[CLIENT] Component mounted, checking server auth...");
    console.log("[CLIENT] Environment check:", {
      hasClientId: !!CLIENT_ID,
      hasRedirectUri: !!REDIRECT_URI,
      redirectUri: REDIRECT_URI,
      hasAdminPassword: !!ADMIN_PASSWORD
    });
    
    const checkServerAuth = async () => {
      // Check if server is authenticated with Spotify
      console.log("[CLIENT] Checking server auth status...");
      try {
        console.log("[CLIENT] Fetching /api/spotify/status...");
        const res = await fetch("/api/spotify/status");
        console.log("[CLIENT] Status response:", {
          ok: res.ok,
          status: res.status,
          statusText: res.statusText
        });
        const data = await res.json();
        console.log("[CLIENT] Status data:", data);
        
        if (data.authenticated) {
          setSpotifyToken("server-authenticated"); // Just a flag
          setIsAuthenticated(true);
          fetchNowPlaying();
        } else {
          // Check URL for authorization code (one-time server setup)
          const urlParams = new URLSearchParams(window.location.search);
          const code = urlParams.get("code");
          const error = urlParams.get("error");

          if (error) {
            toast({
              title: "Authentication Error",
              description: "Failed to authenticate server with Spotify.",
              variant: "destructive",
            });
            window.history.replaceState({}, document.title, window.location.pathname);
            return;
          }

          if (code && CLIENT_ID) {
            console.log("[CLIENT] OAuth callback received with code:", {
              codeLength: code.length,
              codePrefix: code.substring(0, 10) + "...",
              hasClientId: !!CLIENT_ID,
              redirectUri: REDIRECT_URI
            });
            
            // One-time server authentication
            setIsRedirecting(true);
            try {
              const actualRedirectUri = REDIRECT_URI.trim();
              
              console.log("[CLIENT] Preparing token exchange request:", {
                redirectUri: actualRedirectUri,
                codeLength: code.length
              });
              
              if (!actualRedirectUri) {
                throw new Error("Redirect URI is not configured. Please set VITE_SPOTIFY_REDIRECT_URI in environment variables.");
              }
              
              console.log("[CLIENT] Sending POST to /api/spotify/token...");
              const res = await fetch("/api/spotify/token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code, redirectUri: actualRedirectUri }),
              });

              console.log("[CLIENT] Token exchange response:", {
                ok: res.ok,
                status: res.status,
                statusText: res.statusText,
                headers: Object.fromEntries(res.headers.entries())
              });

              if (!res.ok) {
                const errorData = await res.json().catch(async (e) => {
                  const text = await res.text().catch(() => "Could not read response");
                  console.error("[CLIENT] Failed to parse error response:", {
                    error: e,
                    responseText: text.substring(0, 200)
                  });
                  return { error: `HTTP ${res.status}: ${text.substring(0, 100)}` };
                });
                console.error("[CLIENT] Token exchange failed:", errorData);
                throw new Error(errorData.error || "Token exchange failed");
              }

              const responseData = await res.json().catch((e) => {
                console.error("[CLIENT] Failed to parse success response:", e);
                return {};
              });
              console.log("[CLIENT] Token exchange successful:", responseData);

              toast({
                title: "Server Authenticated!",
                description: "Jukebox is now connected to Spotify.",
                className: "text-spotify-green border-spotify-green",
              });
              
              window.history.replaceState({}, document.title, window.location.pathname);
              setSpotifyToken("server-authenticated");
              setIsAuthenticated(true);
              fetchNowPlaying();
            } catch (error: any) {
              console.error("[CLIENT] Server auth error:", {
                message: error.message,
                stack: error.stack,
                name: error.name
              });
              toast({
                title: "Authentication Failed",
                description: error.message || "Failed to authenticate server",
                variant: "destructive",
              });
              setIsRedirecting(false);
            }
          } else if (!data.hasToken && CLIENT_ID) {
            // Server not authenticated - show setup message
            console.log("Server not authenticated. Admin needs to setup.");
          }
        }
      } catch (e) {
        console.error("Error checking server auth:", e);
      }
    };

    checkServerAuth();
    
    // Poll for now playing every 5 seconds
    const interval = setInterval(() => {
      if (spotifyToken) {
        fetchNowPlaying();
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);

  const handleServerLogin = () => {
    // One-time server authentication setup
    const redirectUri = REDIRECT_URI.trim();
    
    if (!CLIENT_ID) {
      toast({
        title: "Configuration Error",
        description: "Spotify Client ID is not configured.",
        variant: "destructive",
      });
      return;
    }
    
    if (!redirectUri) {
      toast({
        title: "Configuration Error",
        description: "Redirect URI is not configured. Please set VITE_SPOTIFY_REDIRECT_URI in environment variables.",
        variant: "destructive",
      });
      return;
    }
    
    setIsRedirecting(true);
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(SCOPES.join(" "))}&response_type=code&show_dialog=true`;
    window.location.href = authUrl;
  };

  const fetchNowPlaying = async () => {
    try {
      // Use server endpoint
      const res = await fetch("/api/spotify/now-playing");
      const data = await res.json();
      
      if (data.track) {
        setCurrentTrack({
          name: data.track.name,
          artist: data.track.artist,
          image: data.track.image
        });
        setIsPlaying(data.playing);
      } else {
        setCurrentTrack({
          name: "Ready to Play",
          artist: "Queue a song to start",
          image: null
        });
        setIsPlaying(false);
      }
    } catch (e) {
      console.error("Error fetching now playing", e);
    }
  };

  const spotifyApiCall = async (action: string, volume?: number) => {
    // Only use password if user is authenticated (entered password in dialog)
    if (!isAuthenticated || !adminPassword) {
      toast({ 
        title: "Authentication Required", 
        description: "Please enter admin password first.", 
        variant: "destructive" 
      });
      return { success: false };
    }

    try {
      const res = await fetch("/api/spotify/control", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "password": adminPassword
        },
        body: JSON.stringify({ action, volume }),
      });

      const data = await res.json();

      if (!res.ok) {
        let errorMessage = data.error || "Command failed";
        
        // Show helpful message if server not authenticated
        if (data.error && data.error.includes("Server not authenticated with Spotify")) {
          errorMessage = "Server needs Spotify authentication. Click 'Setup Server' button first.";
        }
        
        toast({ 
          title: "Error", 
          description: errorMessage, 
          variant: "destructive" 
        });
        return { success: false };
      }

      toast({ title: "Success", className: "text-spotify-green border-spotify-green" });
      setTimeout(() => fetchNowPlaying(), 500);
      return { success: true };
    } catch (e) {
      console.error("Control error:", e);
      toast({ title: "Network Error", description: "Failed to control playback", variant: "destructive" });
      return { success: false };
    }
  };

  // Search for suggestions
  useEffect(() => {
    if (!songInput.trim() || songInput.trim().startsWith("spotify:track:")) {
      setSearchSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const searchTimeout = setTimeout(async () => {
      if (!songInput.trim() || songInput.trim().length < 2) {
        setSearchSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      setIsSearching(true);
      try {
        const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(songInput.trim())}&limit=8`);
        if (res.ok) {
          const data = await res.json();
          setSearchSuggestions(data.tracks || []);
          setShowSuggestions(data.tracks?.length > 0);
        } else {
          setSearchSuggestions([]);
          setShowSuggestions(false);
        }
      } catch (e) {
        console.error("Search error:", e);
        setSearchSuggestions([]);
        setShowSuggestions(false);
      } finally {
        setIsSearching(false);
      }
    }, 300); // Debounce 300ms

    return () => clearTimeout(searchTimeout);
  }, [songInput]);

  const handleSelectSuggestion = (track: SearchTrack) => {
    setSongInput(`${track.name} - ${track.artist}`);
    setShowSuggestions(false);
    setSearchSuggestions([]);
    // Automatically queue the selected song
    handleQueueSongWithUri(track.uri);
  };

  const handleQueueSongWithUri = async (uri?: string) => {
    const songToQueue = uri || songInput.trim();
    if (!songToQueue) {
      toast({ title: "Empty Input", description: "Please enter a song name or Spotify URI", variant: "destructive" });
      return;
    }

    try {
      // Use server endpoint - no authentication required for users
      const res = await fetch("/api/spotify/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          songName: songToQueue.startsWith("spotify:track:") ? undefined : songToQueue,
          uri: songToQueue.startsWith("spotify:track:") ? songToQueue : uri
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({ 
          title: "Error", 
          description: data.error || "Failed to add song to queue", 
          variant: "destructive" 
        });
        return;
      }

      toast({ 
        title: "Success", 
        description: "Song added to queue!", 
        className: "text-spotify-green border-spotify-green" 
      });
      setSongInput("");
      setShowSuggestions(false);
      setSearchSuggestions([]);
      
      // Refresh now playing
      setTimeout(() => fetchNowPlaying(), 500);
    } catch (e) {
      console.error("Queue error:", e);
      toast({ title: "Network Error", description: "Failed to add song", variant: "destructive" });
    }
  };

  const handleQueueSong = () => {
    handleQueueSongWithUri();
  };

  const executeAdminAction = (action: () => void) => {
    console.log("executeAdminAction called, isAuthenticated:", isAuthenticated);
    if (isAuthenticated && adminPassword) {
      action();
    } else {
      console.log("Showing password prompt");
      setPendingAction(() => action);
      setShowPasswordPrompt(true);
    }
  };

  const handlePasswordSubmit = () => {
    if (!ADMIN_PASSWORD) {
      toast({
        title: "Configuration Error",
        description: "Admin password not configured in .env file.",
        variant: "destructive",
      });
      setPasswordInput("");
      return;
    }

    if (passwordInput === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
      setAdminPassword(passwordInput); // Store the entered password
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

  // Show loading screen if redirecting to Spotify
  if (isRedirecting && !spotifyToken) {
    return (
      <div className="min-h-screen bg-[#121212] flex items-center justify-center p-4">
        <Card className="bg-[#121212]/80 backdrop-blur-xl border-white/5 p-8 rounded-2xl shadow-2xl text-center max-w-md">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1DB954] mx-auto mb-4"></div>
          <h2 className="text-2xl font-bold text-[#1DB954] mb-2">Connecting to Spotify...</h2>
          <p className="text-zinc-400">Redirecting to Spotify to authenticate</p>
          <p className="text-zinc-500 text-sm mt-2">Please wait...</p>
        </Card>
      </div>
    );
  }

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
      <Card className="relative w-full max-w-md bg-[#121212]/80 backdrop-blur-xl border-white/5 p-6 md:p-8 rounded-2xl shadow-2xl z-10 overflow-visible">
        
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
          <div className="relative flex gap-2">
            <div className="flex-1 relative z-50">
              <Input 
                type="text" 
                placeholder="Search for a song..."
                className="bg-[#282828] border-[#333] text-white placeholder:text-zinc-500 focus-visible:ring-[#1DB954] pr-10"
                value={songInput}
                onChange={(e) => {
                  setSongInput(e.target.value);
                  if (e.target.value.trim().length >= 2) {
                    setShowSuggestions(true);
                  } else {
                    setShowSuggestions(false);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setShowSuggestions(false);
                    handleQueueSong();
                  } else if (e.key === 'Escape') {
                    setShowSuggestions(false);
                  } else if (e.key === 'ArrowDown' && searchSuggestions.length > 0) {
                    e.preventDefault();
                    setShowSuggestions(true);
                  }
                }}
                onFocus={() => {
                  if (searchSuggestions.length > 0 && songInput.trim().length >= 2) {
                    setShowSuggestions(true);
                  }
                }}
                onBlur={() => {
                  // Delay to allow click on suggestion
                  setTimeout(() => setShowSuggestions(false), 200);
                }}
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <div className="w-4 h-4 border-2 border-[#1DB954] border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
              {/* Search Suggestions Dropdown */}
              {showSuggestions && searchSuggestions.length > 0 && (
                <div className="absolute z-[100] w-full mt-2 bg-[#181818] border border-[#1DB954]/30 rounded-lg shadow-2xl max-h-80 overflow-y-auto backdrop-blur-sm">
                  <div className="p-2">
                    <div className="text-xs text-zinc-500 px-3 py-2 font-semibold uppercase tracking-wider">
                      Suggestions
                    </div>
                    {searchSuggestions.map((track, index) => (
                      <div
                        key={track.id}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSelectSuggestion(track);
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault(); // Prevent input blur
                        }}
                        className="flex items-center gap-3 p-3 hover:bg-[#1DB954]/10 cursor-pointer transition-all rounded-md mb-1 group border border-transparent hover:border-[#1DB954]/20"
                      >
                        {track.image ? (
                          <img 
                            src={track.image} 
                            alt={track.name}
                            className="w-14 h-14 rounded-md object-cover flex-shrink-0 shadow-lg group-hover:shadow-[#1DB954]/20 transition-shadow"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-md bg-[#282828] flex items-center justify-center flex-shrink-0">
                            <Music2 className="w-6 h-6 text-zinc-500" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-semibold truncate group-hover:text-[#1DB954] transition-colors">
                            {track.name}
                          </p>
                          <p className="text-zinc-400 text-sm truncate mt-0.5">
                            {track.artist}
                          </p>
                          {track.album && (
                            <p className="text-zinc-500 text-xs truncate mt-0.5">
                              {track.album}
                            </p>
                          )}
                        </div>
                        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Plus className="w-5 h-5 text-[#1DB954]" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
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
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1">
                {isAuthenticated ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                Admin Controls
              </p>
            </div>
            {/* Show server auth status */}
            {!spotifyToken && CLIENT_ID && (
               <Button 
                 size="sm" 
                 onClick={handleServerLogin} 
                 className="bg-[#1DB954] text-black hover:bg-[#1ed760] text-xs h-7 font-bold"
               >
                 <LogIn className="w-3 h-3 mr-1" /> Setup Server (One-time)
               </Button>
            )}
             {/* If connected, show small status */}
            {spotifyToken && (
               <span className="text-[10px] text-spotify-green flex items-center gap-1">
                 <div className="w-1.5 h-1.5 rounded-full bg-spotify-green animate-pulse"></div>
                 Connected
               </span>
            )}
          </div>
          
          {/* Show message if server not authenticated */}
          {!spotifyToken && CLIENT_ID && (
            <div className="bg-[#282828] border border-yellow-500/30 rounded-md p-3 text-xs text-yellow-400">
              <p className="flex items-center gap-2">
                <Lock className="w-3 h-3" />
                Server needs one-time Spotify authentication. Click "Setup Server" above.
              </p>
            </div>
          )}

          <div className="grid grid-cols-4 gap-3">
            <Button
              variant="secondary"
              className="h-14 bg-[#282828] hover:bg-[#3E3E3E] border-0 text-white"
              onClick={() => executeAdminAction(async () => {
                if(isPlaying) {
                  await spotifyApiCall("pause");
                } else {
                  await spotifyApiCall("play");
                }
              })}
            >
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </Button>

            <Button
              variant="secondary"
              className="h-14 bg-[#282828] hover:bg-[#3E3E3E] border-0 text-white"
              onClick={() => executeAdminAction(async () => {
                await spotifyApiCall("next");
              })}
            >
              <SkipForward className="w-6 h-6" />
            </Button>

            <div 
              className={`col-span-2 bg-[#282828] rounded-md px-3 flex items-center gap-2 ${!isAuthenticated ? 'opacity-60' : ''}`}
            >
              <Volume1 className="w-4 h-4 text-zinc-400" />
              <Slider 
                value={volume} 
                onValueChange={(val) => {
                  if (!isAuthenticated) {
                    // Show password prompt if not authenticated
                    setPendingAction(() => async () => {
                      setVolume(val);
                      await spotifyApiCall("volume", val[0]);
                    });
                    setShowPasswordPrompt(true);
                    return;
                  }
                  setVolume(val);
                  spotifyApiCall("volume", val[0]);
                }}
                max={100} 
                step={1}
                className={isAuthenticated ? "cursor-pointer" : "cursor-not-allowed"} 
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
