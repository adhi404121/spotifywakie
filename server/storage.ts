import { type User, type InsertUser } from "@shared/schema";
import { randomUUID } from "crypto";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
}

// Server-side Spotify token storage
interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // timestamp when token expires
}

class SpotifyTokenStorage {
  private tokens: SpotifyTokens | null = null;

  setTokens(accessToken: string, refreshToken: string, expiresIn: number) {
    this.tokens = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Date.now() + expiresIn * 1000,
    };
  }

  getTokens(): SpotifyTokens | null {
    return this.tokens;
  }

  getAccessToken(): string | null {
    return this.tokens?.access_token || null;
  }

  getRefreshToken(): string | null {
    return this.tokens?.refresh_token || null;
  }

  isTokenExpired(): boolean {
    if (!this.tokens) return true;
    // Consider token expired if it expires in less than 5 minutes
    return Date.now() >= (this.tokens.expires_at - 5 * 60 * 1000);
  }

  clearTokens() {
    this.tokens = null;
  }
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;

  constructor() {
    this.users = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }
}

export const storage = new MemStorage();
export const spotifyTokens = new SpotifyTokenStorage();
