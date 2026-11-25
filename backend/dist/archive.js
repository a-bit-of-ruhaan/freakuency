import { Router } from "express";
import { hashValue } from "./crypto.js";
import { allowedArchiveLicenses, isAllowedArchiveLicense, isPlayableArchiveAudio, selectArchiveAudioFile } from "./archive-license.js";
import { getCached, setCached } from "./cache.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { asyncHandler, asyncRouteError } from "./http.js";
const router = Router();
const searchEndpoint = "https://archive.org/advancedsearch.php";
const metadataEndpoint = "https://archive.org/metadata/";
const archiveTrackInclude = {
    mediaAsset: { select: { licenseVerifiedAt: true } },
};
let discoveryCache;
function isObject(value) {
    return typeof value === "object" && value !== null;
}
function isArchiveSearchResponse(value) {
    if (!isObject(value) || !isObject(value.response) || !Array.isArray(value.response.docs))
        return false;
    return value.response.docs.every((document) => isObject(document) && "identifier" in document && typeof document.identifier === "string");
}
function normalizeText(value, fallback) {
    const text = Array.isArray(value) ? value.join(", ") : value;
    return text?.trim().slice(0, 500) || fallback;
}
function normalizeGenres(...values) {
    return [...new Set(values.flatMap((value) => {
            const entries = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
            return entries.flatMap((entry) => typeof entry === "string" ? entry.split(/[;,]/) : []);
        }).map((genre) => genre.trim()).filter((genre) => genre.length > 1 && genre.length <= 40))].slice(0, 8);
}
function escapeArchiveQuery(value) {
    return value.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, "\\$1");
}
async function archiveJson(url) {
    let response;
    try {
        response = await fetch(url, {
            headers: {
                Accept: "application/json",
                "User-Agent": config.archiveUserAgent,
            },
            signal: AbortSignal.timeout(15_000),
        });
    }
    catch (error) {
        console.error("Internet Archive catalog request failed:", error);
        throw asyncRouteError("Open audio catalog is temporarily unavailable", 502);
    }
    if (!response.ok) {
        console.error(`Internet Archive catalog request failed with status ${response.status}`);
        throw asyncRouteError("Open audio catalog is temporarily unavailable", 502);
    }
    return await response.json();
}
async function getLicensedRecording(document) {
    const identifier = document.identifier;
    if (!/^[a-zA-Z0-9._-]{1,200}$/.test(identifier))
        return null;
    const metadataPayload = await archiveJson(`${metadataEndpoint}${encodeURIComponent(identifier)}`);
    if (!isObject(metadataPayload) || !isObject(metadataPayload.metadata))
        return null;
    const itemMetadata = metadataPayload.metadata;
    const licenseUrl = typeof itemMetadata.licenseurl === "string" ? itemMetadata.licenseurl : undefined;
    if (!isAllowedArchiveLicense(licenseUrl))
        return null;
    if (metadataPayload["access-restricted-item"] === true || metadataPayload["access-restricted-item"] === "true")
        return null;
    const files = Array.isArray(metadataPayload.files)
        ? metadataPayload.files.flatMap((entry) => {
            if (!isObject(entry) || typeof entry.name !== "string")
                return [];
            return [{
                    name: entry.name,
                    size: typeof entry.size === "string" ? entry.size : undefined,
                    length: typeof entry.length === "string" ? entry.length : undefined,
                    private: typeof entry.private === "string" ? entry.private : undefined,
                }];
        })
        : [];
    const file = selectArchiveAudioFile(files);
    if (!file)
        return null;
    const metadataTitle = typeof itemMetadata.title === "string" ? itemMetadata.title : undefined;
    const metadataCreator = typeof itemMetadata.creator === "string"
        ? itemMetadata.creator
        : Array.isArray(itemMetadata.creator) && itemMetadata.creator.every((creator) => typeof creator === "string")
            ? itemMetadata.creator
            : undefined;
    const metadataYear = typeof itemMetadata.year === "string" ? itemMetadata.year : undefined;
    const title = normalizeText(metadataTitle ?? document.title, identifier);
    const creator = normalizeText(metadataCreator ?? document.creator, "Unknown artist");
    const year = metadataYear ?? document.year;
    const metadataAlbum = typeof itemMetadata.album === "string" ? itemMetadata.album : undefined;
    const album = normalizeText(metadataAlbum, typeof year === "string" && year ? `Internet Archive · ${year}` : "Internet Archive");
    const genres = normalizeGenres(itemMetadata.genre)
        .filter((genre) => !["album", "ep", "flac", "mp3", "music", "single"].includes(genre.toLowerCase()));
    const coverUrl = `https://archive.org/services/img/${encodeURIComponent(identifier)}`;
    const durationSeconds = file.length ? Number(file.length) : 0;
    const track = await prisma.track.upsert({
        where: {
            archiveIdentifier_archiveFileName: {
                archiveIdentifier: identifier,
                archiveFileName: file.name,
            },
        },
        create: {
            archiveIdentifier: identifier,
            archiveFileName: file.name,
            audioLicenseUrl: licenseUrl,
            title,
            artist: creator,
            album,
            imageUrl: coverUrl,
            durationMs: Number.isFinite(durationSeconds) ? Math.max(0, Math.round(durationSeconds * 1000)) : 0,
            genres,
        },
        update: {
            audioLicenseUrl: licenseUrl,
            title,
            artist: creator,
            album,
            imageUrl: coverUrl,
            durationMs: Number.isFinite(durationSeconds) ? Math.max(0, Math.round(durationSeconds * 1000)) : 0,
            genres,
        },
    });
    return track;
}
async function searchLicensedTracks(query, rows) {
    const searchUrl = new URL(searchEndpoint);
    const licenseQuery = allowedArchiveLicenses.map((license) => `licenseurl:"${license}"`).join(" OR ");
    searchUrl.search = new URLSearchParams({
        q: `mediatype:audio AND (${licenseQuery}) AND (${query})`,
        rows: String(rows),
        page: "1",
        output: "json",
        sort: "downloads desc",
    }).toString();
    for (const field of ["identifier", "title", "creator", "year"]) {
        searchUrl.searchParams.append("fl[]", field);
    }
    const payload = await archiveJson(searchUrl.toString());
    if (!isArchiveSearchResponse(payload)) {
        throw asyncRouteError("Internet Archive returned an invalid catalog response", 502);
    }
    const candidates = payload.response.docs.slice(0, rows);
    const recordings = [];
    for (let index = 0; index < candidates.length; index += 3) {
        recordings.push(...await Promise.all(candidates.slice(index, index + 3).map(getLicensedRecording)));
    }
    const trackIds = recordings.flatMap((track) => track ? [track.id] : []);
    const tracks = trackIds.length
        ? await prisma.track.findMany({ where: { id: { in: trackIds } }, include: archiveTrackInclude })
        : [];
    const tracksById = new Map(tracks.map((track) => [track.id, track]));
    return {
        tracks: recordings.flatMap((recording) => {
            if (!recording)
                return [];
            const track = tracksById.get(recording.id);
            if (!track || !track.archiveIdentifier || !track.archiveFileName || !track.audioLicenseUrl)
                return [];
            return [{
                    id: track.id,
                    spotifyId: track.spotifyId,
                    musicBrainzRecordingId: track.musicBrainzRecordingId,
                    archiveIdentifier: track.archiveIdentifier,
                    title: track.title,
                    artist: track.artist,
                    album: track.album,
                    imageUrl: track.imageUrl,
                    durationMs: track.durationMs,
                    genres: Array.isArray(track.genres) ? track.genres.filter((genre) => typeof genre === "string") : [],
                    playable: Boolean(track.mediaAsset?.licenseVerifiedAt) || isPlayableArchiveAudio(track),
                    audioLicenseUrl: track.audioLicenseUrl,
                }];
        }),
    };
}
router.get("/discover", asyncHandler(async (_request, response) => {
    if (discoveryCache && discoveryCache.expiresAt > Date.now()) {
        response.json(discoveryCache.result);
        return;
    }
    const cacheKey = "archive-audio-discover:v2";
    const cached = await getCached(cacheKey);
    if (cached) {
        const result = JSON.parse(cached);
        discoveryCache = { result, expiresAt: Date.now() + 3600_000 };
        response.json(result);
        return;
    }
    const styles = "(jazz OR ambient OR electronic OR classical OR folk OR blues OR soul OR hip-hop)";
    const result = await searchLicensedTracks(`collection:opensource_audio AND genre:${styles}`, 30);
    discoveryCache = { result, expiresAt: Date.now() + 3600_000 };
    await setCached(cacheKey, JSON.stringify(result), 3600);
    response.json(result);
}));
router.get("/audio-search", asyncHandler(async (request, response) => {
    const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
    if (query.length < 2 || query.length > 100) {
        throw asyncRouteError("Search query must be between 2 and 100 characters", 400);
    }
    const cacheKey = `archive-audio-search:${hashValue(query.toLocaleLowerCase())}`;
    const cached = await getCached(cacheKey);
    if (cached) {
        response.json(JSON.parse(cached));
        return;
    }
    const result = await searchLicensedTracks(`collection:opensource_audio AND (title:("${escapeArchiveQuery(query)}") OR creator:("${escapeArchiveQuery(query)}"))`, 12);
    await setCached(cacheKey, JSON.stringify(result), 3600);
    response.json(result);
}));
export default router;
