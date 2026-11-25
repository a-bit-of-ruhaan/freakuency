export const allowedArchiveLicenses = [
  "https://creativecommons.org/licenses/by/2.0/",
  "https://creativecommons.org/licenses/by/2.5/",
  "https://creativecommons.org/licenses/by/3.0/",
  "https://creativecommons.org/licenses/by/4.0/",
  "https://creativecommons.org/licenses/by-sa/2.0/",
  "https://creativecommons.org/licenses/by-sa/2.5/",
  "https://creativecommons.org/licenses/by-sa/3.0/",
  "https://creativecommons.org/licenses/by-sa/4.0/",
  "https://creativecommons.org/publicdomain/zero/1.0/",
  "https://creativecommons.org/publicdomain/mark/1.0/",
] as const;
const allowedLicensePaths = new Set(allowedArchiveLicenses.map((value) => new URL(value).pathname.replace(/\/+$/, "")));

export function isAllowedArchiveLicense(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const license = new URL(value);
    return license.protocol === "https:" &&
      license.hostname === "creativecommons.org" &&
      allowedLicensePaths.has(license.pathname.replace(/\/+$/, ""));
  } catch {
    return false;
  }
}

export function isPlayableArchiveAudio(source: {
  archiveIdentifier: string | null;
  archiveFileName: string | null;
  audioLicenseUrl: string | null;
}): boolean {
  return Boolean(
    source.archiveIdentifier &&
    /^[a-zA-Z0-9._-]{1,200}$/.test(source.archiveIdentifier) &&
    source.archiveFileName &&
    !source.archiveFileName.includes("/") &&
    !source.archiveFileName.includes("\\") &&
    audioMimeType(source.archiveFileName) &&
    isAllowedArchiveLicense(source.audioLicenseUrl ?? undefined),
  );
}

export function audioMimeType(fileName: string): string | null {
  const extension = fileName.toLowerCase().split(".").pop();
  switch (extension) {
    case "mp3": return "audio/mpeg";
    case "ogg": return "audio/ogg";
    case "opus": return "audio/ogg";
    case "wav": return "audio/wav";
    case "m4a": return "audio/mp4";
    case "flac": return "audio/flac";
    default: return null;
  }
}

export function isSafeArchiveAudioUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      (url.hostname === "archive.org" || url.hostname.endsWith(".archive.org"));
  } catch {
    return false;
  }
}

export function archiveAudioUrl(identifier: string, fileName: string): string {
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(fileName)}`;
}

export function selectArchiveAudioFile<T extends { name: string; size?: string; private?: string }>(files: T[]): T | undefined {
  return files
    .filter((file) => audioMimeType(file.name) !== null && !file.name.includes("/") && !file.name.includes("\\"))
    .filter((file) => file.private !== "true")
    .filter((file) => !file.size || (/^\d+$/.test(file.size) && Number(file.size) > 0))
    .sort((first, second) => {
      const preference = (name: string) => {
        const extension = name.toLowerCase().split(".").pop();
        return extension === "mp3" ? 0 : extension === "m4a" ? 1 : extension === "ogg" ? 2 : 3;
      };
      return preference(first.name) - preference(second.name);
    })[0];
}
