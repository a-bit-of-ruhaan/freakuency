import "dotenv/config";
import path from "node:path";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  databaseUrl: required("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL,
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID,
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  spotifyRedirectUri: process.env.SPOTIFY_REDIRECT_URI ?? "http://localhost:4000/api/auth/spotify/callback",
  musicBrainzUserAgent: process.env.MUSICBRAINZ_USER_AGENT?.trim() || "Freakuency/1.0 (local development)",
  archiveUserAgent: process.env.ARCHIVE_USER_AGENT?.trim() || "Freakuency/1.0 (local development)",
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "freakuency_session",
  mediaDirectory: path.resolve(process.env.LICENSED_MEDIA_DIR ?? "./media"),
  sessionTtlSeconds: 60 * 60 * 24 * 30,
};

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
