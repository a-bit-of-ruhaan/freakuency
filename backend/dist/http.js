export function asyncHandler(handler) {
    return (request, response, next) => {
        void handler(request, response, next).catch(next);
    };
}
export function readCookie(request, name) {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader)
        return undefined;
    for (const part of cookieHeader.split(";")) {
        const separator = part.indexOf("=");
        if (separator < 0)
            continue;
        if (part.slice(0, separator).trim() !== name)
            continue;
        const value = part.slice(separator + 1).trim();
        try {
            return decodeURIComponent(value);
        }
        catch {
            return undefined;
        }
    }
    return undefined;
}
export function setCookie(response, name, value, maxAgeSeconds) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.append("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`);
}
export function clearCookie(response, name) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.append("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}
export function asyncRouteError(message, status) {
    return Object.assign(new Error(message), { status });
}
