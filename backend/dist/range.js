export function parseByteRange(header, size) {
    if (!header)
        return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match || size < 1)
        return "invalid";
    const startText = match[1] ?? "";
    const endText = match[2] ?? "";
    if (!startText && !endText)
        return "invalid";
    if (!startText) {
        const suffixLength = Number(endText);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0)
            return "invalid";
        return { start: Math.max(size - suffixLength, 0), end: size - 1 };
    }
    const start = Number(startText);
    const requestedEnd = endText ? Number(endText) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= size) {
        return "invalid";
    }
    return { start, end: Math.min(requestedEnd, size - 1) };
}
