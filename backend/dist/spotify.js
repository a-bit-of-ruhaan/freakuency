import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { prisma } from "./db.js";
import { getCached, setCached } from "./cache.js";
import { config } from "./config.js";
import { decryptToken, encryptToken, hashValue } from "./crypto.js";
import { asyncHandler, asyncRouteError, clearCookie, readCookie, setCookie } from "./http.js";
const router = Router();
export const catalogRouter = Router();
const stateCookieName = "freakuency_spotify_state";
const stateLifetimeSeconds = 10 * 60;
let appToken;
function assertSpotifyConfig(includeSecret = false) {
    if (!config.spotifyClientId)
        throw asyncRouteError("Spotify integration is not configured", 503);
    if (includeSecret && !config.spotifyClientSecret)
        throw asyncRouteError("Spotify client secret is not configured", 503);
    return { clientId: config.spotifyClientId, clientSecret: config.spotifyClientSecret };
}
async function readSpotifyError(response) {
    const detail = await response.text();
    console.error(`Spotify request failed (${response.status}): ${detail.slice(0, 500)}`);
    return asyncRouteError("Spotify request failed", response.status === 429 ? 429 : 502);
}
async function exchangeCode(code, verifier) {
    const { clientId } = assertSpotifyConfig();
    const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: clientId,
            grant_type: "authorization_code",
            code,
            redirect_uri: config.spotifyRedirectUri,
            code_verifier: verifier,
        }),
    });
    if (!response.ok)
        throw await readSpotifyError(response);
    const payload = await response.json();
    if (!isTokenResponse(payload))
        throw asyncRouteError("Spotify returned an invalid token response", 502);
    return payload;
}
function isTokenResponse(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const token = value;
    return typeof token.access_token === "string" && typeof token.expires_in === "number";
}
async function fetchProfile(accessToken) {
    const response = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok)
        throw await readSpotifyError(response);
    const payload = await response.json();
    if (typeof payload !== "object" || payload === null || typeof payload.id !== "string") {
        throw asyncRouteError("Spotify returned an invalid profile", 502);
    }
    return payload;
}
router.get("/spotify", asyncHandler(async (_request, response) => {
    const { clientId } = assertSpotifyConfig();
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    await prisma.oAuthAttempt.create({
        data: {
            stateHash: hashValue(state),
            codeVerifier: verifier,
            expiresAt: new Date(Date.now() + stateLifetimeSeconds * 1000),
        },
    });
    setCookie(response, stateCookieName, state, stateLifetimeSeconds);
    const authorizeUrl = new URL("https://accounts.spotify.com/authorize");
    authorizeUrl.search = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: config.spotifyRedirectUri,
        code_challenge_method: "S256",
        code_challenge: challenge,
        state,
        scope: "user-read-email user-read-private",
    }).toString();
    response.redirect(authorizeUrl.toString());
}));
router.get("/spotify/callback", asyncHandler(async (request, response) => {
    const state = typeof request.query.state === "string" ? request.query.state : "";
    const code = typeof request.query.code === "string" ? request.query.code : "";
    const cookieState = readCookie(request, stateCookieName);
    clearCookie(response, stateCookieName);
    if (!state || !code || !cookieState || state.length !== cookieState.length || !createHash("sha256").update(state).digest().equals(createHash("sha256").update(cookieState).digest())) {
        throw asyncRouteError("Spotify authorization state is invalid or expired", 400);
    }
    const attempt = await prisma.oAuthAttempt.findUnique({ where: { stateHash: hashValue(state) } });
    if (!attempt || attempt.expiresAt.getTime() < Date.now())
        throw asyncRouteError("Spotify authorization attempt expired", 400);
    await prisma.oAuthAttempt.delete({ where: { id: attempt.id } });
    const tokens = await exchangeCode(code, attempt.codeVerifier);
    const profile = await fetchProfile(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const user = await prisma.user.upsert({
        where: { spotifyId: profile.id },
        create: {
            spotifyId: profile.id,
            email: profile.email ?? null,
            displayName: profile.display_name?.trim() || "Spotify listener",
            avatarUrl: profile.images?.[0]?.url ?? null,
        },
        update: {
            email: profile.email ?? null,
            displayName: profile.display_name?.trim() || "Spotify listener",
            avatarUrl: profile.images?.[0]?.url ?? null,
        },
    });
    await prisma.spotifyCredential.upsert({
        where: { userId: user.id },
        create: {
            userId: user.id,
            encryptedAccessToken: encryptToken(tokens.access_token),
            encryptedRefreshToken: encryptToken(tokens.refresh_token ?? ""),
            accessTokenExpiresAt: expiresAt,
            scopes: tokens.scope ?? "",
        },
        update: {
            encryptedAccessToken: encryptToken(tokens.access_token),
            ...(tokens.refresh_token ? { encryptedRefreshToken: encryptToken(tokens.refresh_token) } : {}),
            accessTokenExpiresAt: expiresAt,
            scopes: tokens.scope ?? "",
        },
    });
    const rawSessionId = randomBytes(32).toString("base64url");
    await prisma.session.create({
        data: {
            id: hashValue(rawSessionId),
            userId: user.id,
            expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1000),
        },
    });
    setCookie(response, config.sessionCookieName, rawSessionId, config.sessionTtlSeconds);
    response.redirect(`${config.frontendUrl}/?connected=1`);
}));
router.get("/me", asyncHandler(async (request, response) => {
    const rawSessionId = readCookie(request, config.sessionCookieName);
    if (!rawSessionId) {
        response.status(200).json({ user: null });
        return;
    }
    const session = await prisma.session.findUnique({
        where: { id: hashValue(rawSessionId) },
        include: { user: { select: { id: true, displayName: true, email: true, avatarUrl: true } } },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
        if (session)
            await prisma.session.delete({ where: { id: session.id } });
        clearCookie(response, config.sessionCookieName);
        response.status(200).json({ user: null });
        return;
    }
    response.json({ user: session.user });
}));
router.post("/logout", asyncHandler(async (request, response) => {
    const rawSessionId = readCookie(request, config.sessionCookieName);
    if (rawSessionId) {
        await prisma.session.deleteMany({ where: { id: hashValue(rawSessionId) } });
    }
    clearCookie(response, config.sessionCookieName);
    response.status(204).end();
}));
async function getAppAccessToken() {
    if (appToken && appToken.expiresAt > Date.now() + 30_000)
        return appToken.value;
    const { clientId, clientSecret } = assertSpotifyConfig(true);
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
    if (!response.ok)
        throw await readSpotifyError(response);
    const payload = await response.json();
    if (!isTokenResponse(payload))
        throw asyncRouteError("Spotify returned an invalid app token", 502);
    appToken = { value: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
    return appToken.value;
}
catalogRouter.get("/search", asyncHandler(async (request, response) => {
    const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
    if (query.length < 2 || query.length > 100)
        throw asyncRouteError("Search query must be between 2 and 100 characters", 400);
    const cacheKey = `spotify-search:${hashValue(query.toLocaleLowerCase())}`;
    const cached = await getCached(cacheKey);
    if (cached) {
        response.json(JSON.parse(cached));
        return;
    }
    const token = await getAppAccessToken();
    const searchUrl = new URL("https://api.spotify.com/v1/search");
    searchUrl.search = new URLSearchParams({ q: query, type: "track", limit: "20" }).toString();
    const spotifyResponse = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!spotifyResponse.ok)
        throw await readSpotifyError(spotifyResponse);
    const payload = await spotifyResponse.json();
    const items = payload.tracks?.items ?? [];
    await prisma.$transaction(items.map((item) => prisma.track.upsert({
        where: { spotifyId: item.id },
        create: {
            spotifyId: item.id,
            title: item.name,
            artist: item.artists.map((artist) => artist.name).join(", "),
            album: item.album.name,
            imageUrl: item.album.images?.[0]?.url ?? null,
            durationMs: item.duration_ms,
        },
        update: {
            title: item.name,
            artist: item.artists.map((artist) => artist.name).join(", "),
            album: item.album.name,
            imageUrl: item.album.images?.[0]?.url ?? null,
            durationMs: item.duration_ms,
        },
    })));
    const storedTracks = await prisma.track.findMany({
        where: { spotifyId: { in: items.map((item) => item.id) } },
        include: { mediaAsset: { select: { licenseVerifiedAt: true } } },
    });
    const bySpotifyId = new Map(storedTracks.flatMap((track) => track.spotifyId ? [[track.spotifyId, track]] : []));
    const result = {
        tracks: items.flatMap((item) => {
            const track = bySpotifyId.get(item.id);
            return track ? [{
                    id: track.id,
                    spotifyId: item.id,
                    title: item.name,
                    artist: item.artists.map((artist) => artist.name).join(", "),
                    album: item.album.name,
                    imageUrl: item.album.images?.[0]?.url ?? null,
                    durationMs: item.duration_ms,
                    genres: track.genres,
                    playable: Boolean(track.mediaAsset?.licenseVerifiedAt),
                }] : [];
        }),
    };
    await setCached(cacheKey, JSON.stringify(result), 300);
    response.json(result);
}));
export default router;
export async function resolveUserId(request) {
    const rawSessionId = readCookie(request, config.sessionCookieName);
    if (!rawSessionId)
        throw asyncRouteError("Sign in with Spotify to continue", 401);
    const session = await prisma.session.findUnique({ where: { id: hashValue(rawSessionId) } });
    if (!session || session.expiresAt.getTime() <= Date.now())
        throw asyncRouteError("Session expired; sign in again", 401);
    return session.userId;
}
export async function getSpotifyUserAccessToken(userId) {
    const credential = await prisma.spotifyCredential.findUnique({ where: { userId } });
    if (!credential)
        throw asyncRouteError("Spotify account is not connected", 401);
    if (credential.accessTokenExpiresAt.getTime() > Date.now() + 30_000) {
        return decryptToken(credential.encryptedAccessToken);
    }
    const refreshToken = decryptToken(credential.encryptedRefreshToken);
    if (!refreshToken)
        throw asyncRouteError("Spotify session cannot be refreshed; sign in again", 401);
    const { clientId } = assertSpotifyConfig();
    const refreshResponse = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    if (!refreshResponse.ok)
        throw await readSpotifyError(refreshResponse);
    const payload = await refreshResponse.json();
    if (!isTokenResponse(payload))
        throw asyncRouteError("Spotify returned an invalid refresh response", 502);
    await prisma.spotifyCredential.update({
        where: { userId },
        data: {
            encryptedAccessToken: encryptToken(payload.access_token),
            ...(payload.refresh_token ? { encryptedRefreshToken: encryptToken(payload.refresh_token) } : {}),
            accessTokenExpiresAt: new Date(Date.now() + payload.expires_in * 1000),
            scopes: payload.scope ?? credential.scopes,
        },
    });
    return payload.access_token;
}
