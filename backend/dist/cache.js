import { createClient } from "redis";
import { config } from "./config.js";
let client;
let connected = false;
export async function connectCache() {
    if (!config.redisUrl)
        return;
    client = createClient({ url: config.redisUrl });
    client.on("error", (error) => {
        connected = false;
        console.error("Redis connection error:", error.message);
    });
    try {
        await client.connect();
        connected = true;
    }
    catch (error) {
        connected = false;
        console.error("Redis is unavailable; catalog caching is disabled:", error);
        await client.disconnect().catch((disconnectError) => {
            console.error("Could not close the failed Redis connection:", disconnectError);
        });
    }
}
export async function getCached(key) {
    if (!client || !connected || !client.isReady)
        return null;
    try {
        return await client.get(key);
    }
    catch (error) {
        console.error("Redis cache read failed:", error);
        return null;
    }
}
export async function setCached(key, value, ttlSeconds) {
    if (!client || !connected || !client.isReady)
        return;
    try {
        await client.set(key, value, { EX: ttlSeconds });
    }
    catch (error) {
        console.error("Redis cache write failed:", error);
    }
}
export function cacheIsReady() {
    return Boolean(client && connected && client.isReady);
}
export async function disconnectCache() {
    if (!client?.isOpen)
        return;
    await client.quit();
    connected = false;
}
