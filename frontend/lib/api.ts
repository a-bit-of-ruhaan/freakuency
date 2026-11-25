export type ApiTrack = {
  id: string;
  spotifyId: string | null;
  musicBrainzRecordingId?: string | null;
  archiveIdentifier?: string | null;
  title: string;
  artist: string;
  album: string;
  imageUrl: string | null;
  durationMs: number;
  genres: string[];
  playable: boolean;
  audioLicenseUrl?: string | null;
};

export type ApiUser = {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
};

export type ApiPlaylist = {
  id: string;
  name: string;
  description: string | null;
  items: Array<{ track: ApiTrack }>;
};

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    console.error("Freakuency API request could not reach the server:", error);
    throw new ApiError("Can't reach the Freakuency server. Check that the backend is running.", 0);
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}
