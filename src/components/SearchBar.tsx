import React, { useEffect, useRef, useState } from "react";
import { useToken } from "../contexts/TokenContext";

type Track = {
  id: string;
  name: string;
  artists: string;
  album?: string;
  uri?: string;
};

type Props = {
  onSelect: (track: Track) => void;
  placeholder?: string;
  maxResults?: number;
};

export const SearchBar: React.FC<Props> = ({ onSelect, placeholder = "Search songs...", maxResults = 8 }) => {
  const { accessToken } = useToken();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (!query) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void fetchSuggestions(query);
    }, 300);
  }, [query]);

  const fetchSuggestions = async (q: string) => {
    if (!accessToken) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    try {
      const url = new URL("https://api.spotify.com/v1/search");
      url.searchParams.set("q", q);
      url.searchParams.set("type", "track");
      url.searchParams.set("limit", String(maxResults));
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: abortRef.current.signal,
      });
      if (!res.ok) {
        console.error("Spotify search error", await res.text());
        setResults([]);
        setOpen(false);
        setLoading(false);
        return;
      }
      const json = await res.json();
      const tracks: Track[] =
        (json.tracks?.items || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          artists: t.artists.map((a: any) => a.name).join(", "),
          album: t.album?.name,
          uri: t.uri,
        })) || [];
      setResults(tracks);
      setOpen(tracks.length > 0);
      setHighlightIndex(0);
    } catch (err) {
      if ((err as any).name !== "AbortError") console.error(err);
      setResults([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (track: Track) => {
    setQuery(track.name + " — " + track.artists);
    setOpen(false);
    onSelect(track);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[highlightIndex]) handleSelect(results[highlightIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  useEffect(() => {
    const onDocClick = (ev: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", maxWidth: 680 }}>
      <input
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="search-suggestions"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        style={{ width: "100%", padding: "10px 12px", fontSize: 16 }}
      />
      {loading && <div style={{ position: "absolute", right: 10, top: 12 }}>Loading...</div>}
      {open && results.length > 0 && (
        <ul
          id="search-suggestions"
          role="listbox"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            marginTop: 6,
            background: "white",
            border: "1px solid #ddd",
            borderRadius: 6,
            listStyle: "none",
            padding: 0,
            maxHeight: 300,
            overflow: "auto",
            zIndex: 1000,
          }}
        >
          {results.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === highlightIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(r);
              }}
              onMouseEnter={() => setHighlightIndex(i)}
              style={{
                padding: "10px 12px",
                background: i === highlightIndex ? "#f3f4f6" : "white",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span>
                <strong>{r.name}</strong>
                <div style={{ fontSize: 12, color: "#666" }}>{r.artists}</div>
              </span>
              <span style={{ fontSize: 12, color: "#999", alignSelf: "center" }}>{r.album}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
