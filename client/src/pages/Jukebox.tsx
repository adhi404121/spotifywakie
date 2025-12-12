import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, SkipForward, Volume2, Volume1, Plus, Music2, Lock, Unlock } from "lucide-react";
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

const ADMIN_PASSWORD = "A";

export default function Jukebox() {
  const { toast } = useToast();
  const [songInput, setSongInput] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  
  // Mock State for UI
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState([50]);
  const [currentTrack, setCurrentTrack] = useState({
    name: "Ready to Play",
    artist: "Queue a song to start",
    image: null
  });

  const handleQueueSong = () => {
    if (!songInput.trim()) {
      toast({
        title: "Empty Input",
        description: "Please enter a song name or Spotify URI.",
        variant: "destructive",
      });
      return;
    }

    // Mock functionality
    toast({
      title: "Added to Queue",
      description: `"${songInput}" has been added to the queue.`,
      className: "border-l-4 border-l-spotify-green",
    });
    
    // Simulating track update if nothing is playing
    if (currentTrack.name === "Ready to Play") {
      setCurrentTrack({
        name: songInput,
        artist: "Now Playing",
        image: null
      });
      setIsPlaying(true);
    }
    
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

  const togglePlayPause = () => {
    setIsPlaying(!isPlaying);
    toast({
      description: isPlaying ? "Paused" : "Resumed",
    });
  };

  const skipTrack = () => {
    toast({
      description: "Skipped to next track",
    });
  };

  const handleVolumeChange = (value: number[]) => {
    setVolume(value);
    // Debounce toast or just show visually in slider
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
      <Card className="relative w-full max-w-md bg-[#121212]/90 backdrop-blur-xl border-white/10 p-6 md:p-8 rounded-2xl shadow-2xl z-10">
        
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

        {/* Now Playing Info (Mock) */}
        <div className="mb-8 text-center">
           <div className="text-xl font-medium text-white mb-1 truncate">{currentTrack.name}</div>
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
          </div>

          <div className="grid grid-cols-4 gap-3">
            <Button
              variant="secondary"
              className="h-14 bg-[#282828] hover:bg-[#3E3E3E] border-0 text-white"
              onClick={() => executeAdminAction(togglePlayPause)}
            >
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </Button>

            <Button
              variant="secondary"
              className="h-14 bg-[#282828] hover:bg-[#3E3E3E] border-0 text-white"
              onClick={() => executeAdminAction(skipTrack)}
            >
              <SkipForward className="w-6 h-6" />
            </Button>

            <div className="col-span-2 bg-[#282828] rounded-md px-3 flex items-center gap-2">
              <Volume1 className="w-4 h-4 text-zinc-400" />
              <Slider 
                value={volume} 
                onValueChange={(val) => executeAdminAction(() => handleVolumeChange(val))}
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
