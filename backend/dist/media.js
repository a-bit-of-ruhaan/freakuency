import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Router } from "express";
import { archiveAudioUrl, audioMimeType, isPlayableArchiveAudio, isSafeArchiveAudioUrl } from "./archive-license.js";
import { prisma } from "./db.js";
import { config } from "./config.js";
import { asyncHandler, asyncRouteError } from "./http.js";
import { parseByteRange } from "./range.js";
const router = Router();
router.get("/tracks/:trackId/stream", asyncHandler(async (request, response) => {
    const track = await prisma.track.findUnique({
        where: { id: request.params.trackId },
        include: { mediaAsset: true },
    });
    const asset = track?.mediaAsset;
    if (!track)
        throw asyncRouteError("Track not found", 404);
    if (!asset && track.archiveIdentifier && track.archiveFileName && track.audioLicenseUrl) {
        if (!isPlayableArchiveAudio(track)) {
            throw asyncRouteError("This Internet Archive audio license is not supported for streaming", 403);
        }
        const mimeType = audioMimeType(track.archiveFileName);
        if (!mimeType)
            throw asyncRouteError("This Internet Archive audio format is unsupported", 415);
        const upstreamUrl = archiveAudioUrl(track.archiveIdentifier, track.archiveFileName);
        if (!isSafeArchiveAudioUrl(upstreamUrl))
            throw asyncRouteError("Internet Archive audio URL is invalid", 500);
        const abortController = new AbortController();
        const abortRequest = () => abortController.abort();
        let cleanup = () => { };
        const abortResponse = () => {
            if (!response.writableEnded)
                abortController.abort();
            cleanup();
        };
        cleanup = () => {
            request.off("aborted", abortRequest);
            response.off("close", abortResponse);
        };
        request.once("aborted", abortRequest);
        response.once("close", abortResponse);
        let upstream;
        try {
            let currentUrl = upstreamUrl;
            for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
                if (!isSafeArchiveAudioUrl(currentUrl))
                    throw asyncRouteError("Internet Archive redirected to an unsupported host", 502);
                upstream = await fetch(currentUrl, {
                    headers: {
                        ...(request.headers.range ? { Range: request.headers.range } : {}),
                        "User-Agent": config.archiveUserAgent,
                    },
                    redirect: "manual",
                    signal: abortController.signal,
                });
                if (![301, 302, 303, 307, 308].includes(upstream.status))
                    break;
                const location = upstream.headers.get("location");
                if (!location || redirectCount === 4)
                    throw asyncRouteError("Internet Archive audio redirect could not be followed", 502);
                await upstream.body?.cancel();
                currentUrl = new URL(location, currentUrl).toString();
            }
            if (!upstream)
                throw asyncRouteError("Internet Archive returned no audio response", 502);
            if (upstream.status !== 200 && upstream.status !== 206 && upstream.status !== 416) {
                console.error(`Internet Archive audio stream failed with status ${upstream.status}`);
                throw asyncRouteError(upstream.status === 404 ? "Internet Archive audio file is unavailable" : "Internet Archive audio stream failed", upstream.status === 404 ? 404 : 502);
            }
            const headers = {
                "Accept-Ranges": upstream.headers.get("accept-ranges") ?? "bytes",
                "Cache-Control": "public, max-age=3600",
                "Content-Type": mimeType,
            };
            for (const name of ["content-length", "content-range"]) {
                const value = upstream.headers.get(name);
                if (value)
                    headers[name === "content-length" ? "Content-Length" : "Content-Range"] = value;
            }
            response.status(upstream.status).set(headers);
            if (upstream.status === 416 || !upstream.body) {
                cleanup();
                response.end();
                return;
            }
            const reader = upstream.body.getReader();
            const audioChunks = async function* () {
                try {
                    while (true) {
                        const chunk = await reader.read();
                        if (chunk.done)
                            return;
                        yield chunk.value;
                    }
                }
                finally {
                    reader.releaseLock();
                }
            };
            const stream = Readable.from(audioChunks());
            stream.once("end", cleanup);
            stream.once("close", cleanup);
            stream.on("error", (error) => {
                cleanup();
                if (abortController.signal.aborted)
                    return;
                console.error("Internet Archive audio stream failed:", error);
                if (!response.headersSent)
                    response.status(502).end();
                else
                    response.destroy(error);
            });
            stream.pipe(response);
        }
        catch (error) {
            cleanup();
            if (abortController.signal.aborted)
                return;
            throw error;
        }
        return;
    }
    if (!asset)
        throw asyncRouteError("No authorized audio asset is available for this track", 404);
    if (!asset.licenseVerifiedAt || !asset.rightsHolder.trim() || !asset.licenseReference.trim()) {
        throw asyncRouteError("This audio asset is not verified for streaming", 403);
    }
    if (!asset.mimeType.startsWith("audio/"))
        throw asyncRouteError("Audio asset has an unsupported media type", 415);
    const realMediaRoot = await realpath(config.mediaDirectory);
    const candidate = path.resolve(realMediaRoot, asset.storageKey);
    if (!candidate.startsWith(`${realMediaRoot}${path.sep}`))
        throw asyncRouteError("Audio asset path is invalid", 500);
    const realFile = await realpath(candidate);
    if (!realFile.startsWith(`${realMediaRoot}${path.sep}`))
        throw asyncRouteError("Audio asset path escapes the media library", 500);
    const fileInfo = await stat(realFile);
    if (!fileInfo.isFile() || !Number.isSafeInteger(fileInfo.size) || fileInfo.size !== Number(asset.byteLength)) {
        throw asyncRouteError("Audio asset is unavailable or changed since it was registered", 404);
    }
    const range = parseByteRange(request.headers.range, fileInfo.size);
    if (range === "invalid") {
        response.status(416).set({
            "Accept-Ranges": "bytes",
            "Content-Range": `bytes */${fileInfo.size}`,
        }).end();
        return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? fileInfo.size - 1;
    const contentLength = end - start + 1;
    response.status(range ? 206 : 200).set({
        "Accept-Ranges": "bytes",
        "Content-Type": asset.mimeType,
        "Content-Length": String(contentLength),
        "Cache-Control": "private, no-store",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${fileInfo.size}` } : {}),
    });
    const stream = createReadStream(realFile, { start, end });
    stream.on("error", (error) => {
        console.error("Audio file stream failed:", error);
        if (!response.headersSent)
            response.status(500).end();
        else
            response.destroy(error);
    });
    stream.pipe(response);
}));
export default router;
