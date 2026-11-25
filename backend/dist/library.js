import { Router } from "express";
import { isPlayableArchiveAudio } from "./archive-license.js";
import { prisma } from "./db.js";
import { asyncHandler, asyncRouteError } from "./http.js";
import { resolveUserId } from "./spotify.js";
const router = Router();
const trackInclude = {
    mediaAsset: { select: { id: true, licenseVerifiedAt: true } },
};
const playlistInclude = {
    items: {
        orderBy: { position: "asc" },
        include: { track: { include: { mediaAsset: { select: { licenseVerifiedAt: true } } } } },
    },
};
const favoriteInclude = {
    track: { include: { mediaAsset: { select: { licenseVerifiedAt: true } } } },
};
router.get("/tracks", asyncHandler(async (request, response) => {
    const parsedLimit = Number(request.query.limit ?? 30);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        throw asyncRouteError("limit must be an integer between 1 and 100", 400);
    }
    const tracks = await prisma.track.findMany({
        take: parsedLimit,
        orderBy: { createdAt: "desc" },
        include: trackInclude,
    });
    response.json({
        tracks: tracks.map(({ mediaAsset, ...track }) => ({
            ...track,
            playable: Boolean(mediaAsset?.licenseVerifiedAt) || isPlayableArchiveAudio(track),
        })),
    });
}));
router.get("/playlists", asyncHandler(async (request, response) => {
    const userId = await resolveUserId(request);
    const playlists = await prisma.playlist.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: playlistInclude,
    });
    response.json({
        playlists: playlists.map((playlist) => ({
            ...playlist,
            items: playlist.items.map(({ track, ...item }) => ({
                ...item,
                track: {
                    ...track,
                    playable: Boolean(track.mediaAsset?.licenseVerifiedAt) || isPlayableArchiveAudio(track),
                    mediaAsset: undefined,
                },
            })),
        })),
    });
}));
router.post("/playlists", asyncHandler(async (request, response) => {
    const userId = await resolveUserId(request);
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    const description = typeof request.body?.description === "string" ? request.body.description.trim() : null;
    if (name.length < 1 || name.length > 80)
        throw asyncRouteError("Playlist name must be between 1 and 80 characters", 400);
    if (description && description.length > 300)
        throw asyncRouteError("Playlist description must be 300 characters or less", 400);
    const playlist = await prisma.playlist.create({ data: { userId, name, description } });
    response.status(201).json({ playlist });
}));
router.post("/playlists/:playlistId/tracks", asyncHandler(async (request, response) => {
    const userId = await resolveUserId(request);
    const playlistId = request.params.playlistId;
    if (!playlistId)
        throw asyncRouteError("playlistId is required", 400);
    const trackId = typeof request.body?.trackId === "string" ? request.body.trackId : "";
    const playlist = await prisma.playlist.findFirst({ where: { id: playlistId, userId }, select: { id: true } });
    if (!playlist)
        throw asyncRouteError("Playlist not found", 404);
    if (!trackId)
        throw asyncRouteError("trackId is required", 400);
    const track = await prisma.track.findUnique({ where: { id: trackId }, select: { id: true } });
    if (!track)
        throw asyncRouteError("Track not found", 404);
    const item = await prisma.$transaction(async (transaction) => {
        const lastItem = await transaction.playlistItem.findFirst({
            where: { playlistId },
            orderBy: { position: "desc" },
            select: { position: true },
        });
        return transaction.playlistItem.create({
            data: { playlistId, trackId, position: (lastItem?.position ?? -1) + 1 },
            include: { track: true },
        });
    });
    response.status(201).json({ item });
}));
router.delete("/playlists/:playlistId/tracks/:trackId", asyncHandler(async (request, response) => {
    const userId = await resolveUserId(request);
    const { playlistId, trackId } = request.params;
    if (!playlistId || !trackId)
        throw asyncRouteError("playlistId and trackId are required", 400);
    const playlist = await prisma.playlist.findFirst({ where: { id: playlistId, userId }, select: { id: true } });
    if (!playlist)
        throw asyncRouteError("Playlist not found", 404);
    await prisma.playlistItem.deleteMany({ where: { playlistId, trackId } });
    response.status(204).end();
}));
router.get("/favorites", asyncHandler(async (request, response) => {
    const userId = await resolveUserId(request);
    const favorites = await prisma.favorite.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: favoriteInclude,
    });
    response.json({
        tracks: favorites.map(({ track }) => ({
            ...track,
            playable: Boolean(track.mediaAsset?.licenseVerifiedAt) || isPlayableArchiveAudio(track),
            mediaAsset: undefined,
        })),
    });
}));
router.put("/favorites/:trackId", asyncHandler(async (request, response) => {
    const userId = await resolveUserId(request);
    const trackId = request.params.trackId;
    if (!trackId)
        throw asyncRouteError("trackId is required", 400);
    const track = await prisma.track.findUnique({ where: { id: trackId }, select: { id: true } });
    if (!track)
        throw asyncRouteError("Track not found", 404);
    await prisma.favorite.upsert({
        where: { userId_trackId: { userId, trackId } },
        create: { userId, trackId },
        update: {},
    });
    response.status(204).end();
}));
router.delete("/favorites/:trackId", asyncHandler(async (request, response) => {
    const userId = await resolveUserId(request);
    await prisma.favorite.deleteMany({ where: { userId, trackId: request.params.trackId } });
    response.status(204).end();
}));
export default router;
