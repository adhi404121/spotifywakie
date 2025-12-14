import React, { createContext, useContext, useEffect, useRef, useState } from "react";

type TokenContextValue = {
  accessToken: string | null;
  setAccessToken: (token: string | null, expiresIn?: number) => void;
  refreshAccessToken: () => Promise<void>;
};

const TokenContext = createContext<TokenContextValue | undefined>(undefined);

export const useToken = (): TokenContextValue => {
  const ctx = useContext(TokenContext);
  if (!ctx) throw new Error("useToken must be used within TokenProvider");
  return ctx;
};

export const TokenProvider: React.FC<{ initialToken?: string; initialExpiresIn?: number }> = ({
  children,
  initialToken = null,
  initialExpiresIn,
}) => {
  const [accessToken, setAccessTokenState] = useState<string | null>(initialToken);
  const expiryRef = useRef<number | null>(initialExpiresIn ? Date.now() + initialExpiresIn * 1000 : null);
  const refreshTimerRef = useRef<number | null>(null);

  const scheduleRefresh = (expiresAt: number | null) => {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (!expiresAt) return;
    const msLeft = expiresAt - Date.now();
    // refresh 60s before expiry, but at least after 5s
    const refreshBefore = Math.max(5000, 60000);
    const timeout = Math.max(0, msLeft - refreshBefore);
    refreshTimerRef.current = window.setTimeout(() => {
      void refreshAccessToken();
    }, timeout);
  };

  const setAccessToken = (token: string | null, expiresIn?: number) => {
    setAccessTokenState(token);
    if (token && expiresIn) {
      expiryRef.current = Date.now() + expiresIn * 1000;
    } else {
      expiryRef.current = null;
    }
    if (token) {
      localStorage.setItem("access_token", token);
      if (expiresIn) localStorage.setItem("access_token_expires_at", String(Date.now() + expiresIn * 1000));
    } else {
      localStorage.removeItem("access_token");
      localStorage.removeItem("access_token_expires_at");
    }
    scheduleRefresh(expiryRef.current);
  };

  const refreshAccessToken = async (): Promise<void> => {
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      if (!res.ok) {
        console.error("Failed to refresh token", await res.text());
        setAccessToken(null);
        return;
      }
      const data = await res.json();
      // expected: { access_token: string, expires_in: number }
      setAccessToken(data.access_token, data.expires_in);
    } catch (err) {
      console.error("Error refreshing token", err);
      setAccessToken(null);
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem("access_token");
    const storedExpiry = localStorage.getItem("access_token_expires_at");
    if (stored) {
      setAccessTokenState(stored);
      expiryRef.current = storedExpiry ? Number(storedExpiry) : null;
      scheduleRefresh(expiryRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    };
  }, []);

  return (
    <TokenContext.Provider value={{ accessToken, setAccessToken, refreshAccessToken }}>
      {children}
    </TokenContext.Provider>
  );
};
