import { Router } from "express";
import { getCached, setCached } from "./cache.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { asyncHandler, asyncRouteError } from "./http.js";
const router = Router();
const musicBrainzBaseUrl = "https://musicbrainz.org/ws/2/recording";
const storedTrackInclude = {
    mediaAsset: { select: { licenseVerifiedAt: true } },
};
let nextRequestAt = 0;
let requestQueue = Promise.resolve();
async function requestMusicBrainz(url) {
    const request = requestQueue.then(async () => {
        const waitMs = Math.max(0, nextRequestAt - Date.now());
        if (waitMs)
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        nextRequestAt = Date.now() + 1100;
        const response = await fetch(url, {
            headers: {
                Accept: "application/json",
                "User-Agent": config.musicBrainzUserAgent,
            },
        });
        if (!response.ok) {
            const status = response.status === 503 ? 503 : 502;
            console.error(`MusicBrainz request failed with status ${response.status}`);
            throw asyncRouteError("MusicBrainz catalog is temporarily unavailable", status);
        }
        return response;
    });
    requestQueue = request.then(() => undefined, () => undefined);
    return request;
}
function recordingArtist(recording) {
    return (recording["artist-credit"] ?? [])
        .map((credit) => credit.artist?.name ?? credit.name ?? "")
        .filter(Boolean)
        .join(", ") || "Unknown artist";
}
function coverArtUrl(releaseId) {
    return releaseId ? `https://coverartarchive.org/release/${encodeURIComponent(releaseId)}/front-250` : null;
}
function isMusicBrainzResponse(value) {
    if (typeof value !== "object" || value === null || !("recordings" in value) || !Array.isArray(value.recordings)) {
        return false;
    }
    return value.recordings.every((item) => typeof item === "object" && item !== null &&
        "id" in item && typeof item.id === "string" &&
        "title" in item && typeof item.title === "string");
}
router.get("/search", asyncHandler(async (request, response) => {
    const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
    if (query.length < 2 || query.length > 100) {
        throw asyncRouteError("Search query must be between 2 and 100 characters", 400);
    }
    const cacheKey = `musicbrainz-search:${query.toLocaleLowerCase()}`;
    const cached = await getCached(cacheKey);
    if (cached) {
        response.json(JSON.parse(cached));
        return;
    }
    const searchUrl = new URL(musicBrainzBaseUrl);
    searchUrl.search = new URLSearchParams({ query, fmt: "json", limit: "20" }).toString();
    const upstreamResponse = await requestMusicBrainz(searchUrl.toString());
    const payload = await upstreamResponse.json();
    if (!isMusicBrainzResponse(payload)) {
        throw asyncRouteError("MusicBrainz returned an invalid catalog response", 502);
    }
    const recordings = payload.recordings.filter((recording) => recording.id);
    await prisma.$transaction(recordings.map((recording) => {
        const release = recording.releases?.[0];
        const tags = (recording.tags ?? [])
            .sort((first, second) => (second.count ?? 0) - (first.count ?? 0))
            .slice(0, 8)
            .map((tag) => tag.name);
        return prisma.track.upsert({
            where: { musicBrainzRecordingId: recording.id },
            create: {
                musicBrainzRecordingId: recording.id,
                title: recording.title,
                artist: recordingArtist(recording),
                album: release?.title ?? "Single",
                imageUrl: coverArtUrl(release?.id),
                durationMs: Math.max(0, Math.round(recording.length ?? 0)),
                genres: tags,
            },
            update: {
                title: recording.title,
                artist: recordingArtist(recording),
                album: release?.title ?? "Single",
                imageUrl: coverArtUrl(release?.id),
                durationMs: Math.max(0, Math.round(recording.length ?? 0)),
                genres: tags,
            },
        });
    }));
    const tracks = await prisma.track.findMany({
        where: { musicBrainzRecordingId: { in: recordings.map((recording) => recording.id) } },
        include: storedTrackInclude,
    });
    const tracksByRecordingId = new Map(tracks.flatMap((track) => track.musicBrainzRecordingId ? [[track.musicBrainzRecordingId, track]] : []));
    const result = {
        tracks: recordings.flatMap((recording) => {
            const track = tracksByRecordingId.get(recording.id);
            if (!track)
                return [];
            return [{
                    id: track.id,
                    spotifyId: track.spotifyId,
                    musicBrainzRecordingId: recording.id,
                    title: track.title,
                    artist: track.artist,
                    album: track.album,
                    imageUrl: track.imageUrl,
                    durationMs: track.durationMs,
                    genres: track.genres,
                    playable: Boolean(track.mediaAsset?.licenseVerifiedAt),
                }];
        }),
    };
    await setCached(cacheKey, JSON.stringify(result), 3600);
    response.json(result);
}));
export default router;
