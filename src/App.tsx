import React from "react";
import { SearchBar } from "./components/SearchBar";
import { useToken } from "./contexts/TokenContext";

const App: React.FC = () => {
  const { setAccessToken } = useToken();

  // Example: call this after your auth flow to set token
  // setAccessToken("<ACCESS_TOKEN_FROM_LOGIN>", expiresInSeconds);

  const onSelectSong = (track: any) => {
    console.log("Selected track:", track);
    // handle the selected track (play, add to queue, save, etc.)
  };

  return (
    <div style={{ padding: 24 }}>
      <h1>Spotify Wakie</h1>
      <SearchBar onSelect={onSelectSong} maxResults={6} />
      {/* The rest of your UI */}
    </div>
  );
};

export default App;
