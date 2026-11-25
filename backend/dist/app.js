import cors from "cors";
import express from "express";
import { cacheIsReady } from "./cache.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { asyncRouteError } from "./http.js";
import archiveRouter from "./archive.js";
import libraryRouter from "./library.js";
import mediaRouter from "./media.js";
import musicBrainzRouter from "./musicbrainz.js";
import spotifyRouter, { catalogRouter } from "./spotify.js";
const app = express();
app.disable("x-powered-by");
app.use(cors({
    origin: config.frontendUrl,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Range"],
    exposedHeaders: ["Accept-Ranges", "Content-Length", "Content-Range"],
}));
app.use((request, _response, next) => {
    const origin = request.headers.origin;
    const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (isMutation && origin && origin !== config.frontendUrl) {
        next(asyncRouteError("Request origin is not allowed", 403));
        return;
    }
    next();
});
app.use(express.json({ limit: "32kb" }));
app.get("/api/health", async (_request, response) => {
    try {
        await prisma.$queryRaw `SELECT 1`;
    }
    catch (error) {
        console.error("Database health check failed:", error);
        response.status(503).json({ status: "degraded", database: "unavailable", cache: cacheIsReady() ? "ready" : "unavailable" });
        return;
    }
    response.json({ status: "ok", database: "ready", cache: cacheIsReady() ? "ready" : "unavailable" });
});
app.use("/api/auth", spotifyRouter);
app.use("/api/catalog", archiveRouter);
app.use("/api/catalog", musicBrainzRouter);
app.use("/api/catalog", libraryRouter);
app.use("/api/catalog", catalogRouter);
app.use("/api", libraryRouter);
app.use("/api", mediaRouter);
app.use((_request, _response, next) => next(asyncRouteError("Route not found", 404)));
const errors = (error, _request, response, _next) => {
    const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
        ? error.status
        : 500;
    if (status >= 500)
        console.error("API request failed:", error);
    const message = status >= 500 ? "An internal error occurred" : error instanceof Error ? error.message : "Request failed";
    response.status(status).json({ error: message });
};
app.use(errors);
export default app;
