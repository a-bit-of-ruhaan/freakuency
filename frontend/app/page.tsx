"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AudioLines,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Disc3,
  Ellipsis,
  Heart,
  Home,
  ListMusic,
  Maximize2,
  Mic2,
  Pause,
  Play,
  Plus,
  Radio,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
} from "lucide-react";
import { apiRequest, getApiBaseUrl, type ApiPlaylist, type ApiTrack, type ApiUser } from "../lib/api";
import { usePlayerStore, type PlayerTrack } from "../lib/player-store";
import { AudioVisualizer } from "../components/AudioVisualizer";

type Track = ApiTrack & {
  duration: string;
  art: string;
  accent: string;
};

const artStyles = ["art-one", "art-two", "art-three", "art-four", "art-five", "art-six"];
const accents = ["#d8e1a6", "#f2a66f", "#ce7695", "#6fa6c5", "#c095bb", "#e5b76d"];
const placeholderTrack: Track = {
  id: "",
  spotifyId: null,
  musicBrainzRecordingId: null,
  title: "Find your next repeat",
  artist: "Search for openly licensed audio to get started",
  album: "Freakuency",
  imageUrl: null,
  durationMs: 0,
  genres: [],
  playable: false,
  duration: "0:00",
  art: "art-one",
  accent: "#d8e1a6",
};

function toTrack(track: ApiTrack, index: number): Track {
  return {
    ...track,
    duration: `${Math.floor(track.durationMs / 60000)}:${String(Math.floor((track.durationMs % 60000) / 1000)).padStart(2, "0")}`,
    art: artStyles[index % artStyles.length],
    accent: accents[index % accents.length],
  };
}

function formatPlaybackTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function Cover({ track, className = "" }: { track: Track; className?: string }) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const showImage = Boolean(track.imageUrl && failedImageUrl !== track.imageUrl);

  return (
    showImage && track.imageUrl ? (
      <img className={`cover real-cover ${className}`} src={track.imageUrl} alt={`${track.album} album artwork`} onError={() => setFailedImageUrl(track.imageUrl)} />
    ) : (
      <div className={`cover ${track.art} ${className}`} style={{ "--cover-accent": track.accent } as React.CSSProperties}>
        <span className="cover-grain" />
        <span className="cover-shape" />
        <span className="cover-label">{track.album}</span>
      </div>
    )
  );
}

export default function HomePage() {
  const [searchSource, setSearchSource] = useState<"open-audio" | "metadata">("open-audio");
  const [activeNav, setActiveNav] = useState("For you");
  const [activeMood, setActiveMood] = useState("All sounds");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [discoveryTracks, setDiscoveryTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<ApiPlaylist[]>([]);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState("");
  const [queryError, setQueryError] = useState("");
  const [liked, setLiked] = useState(false);
  const [query, setQuery] = useState("");
  const playerTrack = usePlayerStore((state) => state.currentTrack);
  const queue = usePlayerStore((state) => state.queue);
  const queueIndex = usePlayerStore((state) => state.queueIndex);
  const isShuffled = usePlayerStore((state) => state.isShuffled);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const isLoadingTrack = usePlayerStore((state) => state.isLoading);
  const playerError = usePlayerStore((state) => state.error);
  const currentTime = usePlayerStore((state) => state.currentTime);
  const duration = usePlayerStore((state) => state.duration);
  const volume = usePlayerStore((state) => state.volume);
  const selectPlayerTrack = usePlayerStore((state) => state.playTrack);
  const togglePlayback = usePlayerStore((state) => state.togglePlayback);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const skipPlayerTrack = usePlayerStore((state) => state.skipTrack);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const currentTrack = playerTrack ? toTrack(playerTrack, Math.max(0, tracks.findIndex((track) => track.id === playerTrack.id))) : tracks[0] ?? placeholderTrack;
  const playbackDuration = Math.max(duration || currentTrack.durationMs / 1000, 1);
  const playbackProgress = Math.min(100, (currentTime / playbackDuration) * 100);
  const queuedTrack = queue.length > 1 ? queue[(queueIndex + 1) % queue.length] : null;

  useEffect(() => {
    let cancelled = false;
    const loadInitialData = async () => {
      setIsLoading(true);
      const [catalogResult, userResult] = await Promise.allSettled([
        apiRequest<{ tracks: ApiTrack[] }>("/api/catalog/discover"),
        apiRequest<{ user: ApiUser | null }>("/api/auth/me"),
      ]);
      if (cancelled) return;
      if (catalogResult.status === "fulfilled") {
        const discovered = catalogResult.value.tracks.map(toTrack);
        setDiscoveryTracks(discovered);
        setTracks(discovered);
      } else setApiError(catalogResult.reason instanceof Error ? catalogResult.reason.message : "Could not load the track catalog.");
      if (userResult.status === "fulfilled") {
        setUser(userResult.value.user);
        if (userResult.value.user) {
          try {
            const response = await apiRequest<{ playlists: ApiPlaylist[] }>("/api/playlists");
            if (!cancelled) setPlaylists(response.playlists);
          } catch (error) {
            if (!cancelled) setApiError(error instanceof Error ? error.message : "Could not load playlists.");
          }
        }
      } else if (!cancelled && catalogResult.status === "fulfilled") {
        setApiError(userResult.reason instanceof Error ? userResult.reason.message : "Could not check your account.");
      }
      if (!cancelled) setIsLoading(false);
    };
    void loadInitialData();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setTracks(discoveryTracks);
      setQueryError("");
      return;
    }
    if (normalizedQuery.length < 2) {
      setQueryError("Type at least two characters to search the music catalog.");
      return;
    }
    const controller = new AbortController();
    const searchEndpoint = searchSource === "open-audio" ? "/api/catalog/audio-search" : "/api/catalog/search";
    const timeout = window.setTimeout(() => {
      void apiRequest<{ tracks: ApiTrack[] }>(`${searchEndpoint}?q=${encodeURIComponent(normalizedQuery)}`, { signal: controller.signal })
        .then((response) => {
          setTracks(response.tracks.map(toTrack));
          setActiveMood("All sounds");
          setQueryError("");
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setQueryError(error instanceof Error ? error.message : "Music catalog search failed.");
        });
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, searchSource, discoveryTracks]);

  const visibleTracks = useMemo(
    () =>
      tracks.filter((track) => {
        return activeMood === "All sounds" || track.genres.some((genre) => genre.toLowerCase() === activeMood.toLowerCase());
      }),
    [activeMood, tracks],
  );

  function playTrack(track: Track) {
    const queueTracks: PlayerTrack[] = tracks.map((queueTrack) => ({
      ...queueTrack,
      streamUrl: queueTrack.playable ? `${getApiBaseUrl()}/api/tracks/${encodeURIComponent(queueTrack.id)}/stream` : undefined,
    }));
    setQueue(queueTracks, track.id);
    selectPlayerTrack({
      ...track,
      streamUrl: track.playable ? `${getApiBaseUrl()}/api/tracks/${encodeURIComponent(track.id)}/stream` : undefined,
    });
  }

  function connectSpotify() {
    window.location.assign(`${getApiBaseUrl()}/api/auth/spotify`);
  }

  async function toggleFavorite() {
    if (!user || !playerTrack) {
      setApiError("Connect Spotify and select a track before saving favorites.");
      return;
    }
    try {
      if (liked) await apiRequest(`/api/favorites/${encodeURIComponent(playerTrack.id)}`, { method: "DELETE" });
      else await apiRequest(`/api/favorites/${encodeURIComponent(playerTrack.id)}`, { method: "PUT" });
      setLiked(!liked);
      setApiError("");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not update your favorites.");
    }
  }

  async function createPlaylist() {
    if (!user) {
      setApiError("Connect Spotify to create a playlist.");
      return;
    }
    const name = window.prompt("Name your playlist");
    if (!name?.trim()) return;
    try {
      const result = await apiRequest<{ playlist: ApiPlaylist }>("/api/playlists", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setPlaylists((items) => [result.playlist, ...items]);
      setApiError("");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not create playlist.");
    }
  }

  async function logout() {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
      setUser(null);
      setPlaylists([]);
      setApiError("");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not sign out.");
    }
  }

  function moveTrack(direction: number) {
    if (!tracks.length) {
      setApiError("Search for a track before skipping.");
      return;
    }
    const index = tracks.findIndex((track) => track.id === currentTrack.id);
    if (index < 0) {
      playTrack(tracks[direction > 0 ? 0 : tracks.length - 1]);
      return;
    }
    const queueTracks: PlayerTrack[] = tracks.map((track) => ({
      ...track,
      streamUrl: track.playable ? `${getApiBaseUrl()}/api/tracks/${encodeURIComponent(track.id)}/stream` : undefined,
    }));
    setQueue(queueTracks, currentTrack.id);
    skipPlayerTrack(direction === -1 ? -1 : 1);
  }

  function handleHeroPlay() {
    if (!currentTrack.playable) {
      document.querySelector<HTMLInputElement>(".search-box input")?.focus();
      return;
    }
    togglePlayback();
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Freakuency home">
          <span className="brand-mark"><AudioLines size={20} strokeWidth={2.4} /></span>
          <span>freakuency<span className="brand-period">.</span></span>
        </a>

        <div className="sidebar-label">YOUR SPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {[
            { label: "For you", icon: Home },
            { label: "Explore", icon: Search },
            { label: "Radio", icon: Radio },
          ].map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-link ${activeNav === label ? "selected" : ""}`} onClick={() => setActiveNav(label)}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
              {label === "For you" && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>

        <div className="library-heading">
          <div className="sidebar-label">YOUR LIBRARY</div>
          <button className="icon-button small" aria-label="Create playlist" onClick={() => void createPlaylist()}><Plus size={16} /></button>
        </div>
        <nav className="library-nav" aria-label="Your library">
          <button className="library-item" onClick={() => setActiveNav("Liked tracks")}><span className="library-icon liked-icon"><Heart size={15} fill="currentColor" /></span><span>Liked tracks</span></button>
          <button className="library-item"><span className="library-icon"><ListMusic size={16} /></span><span>Playlists</span><ChevronDown size={14} className="library-chevron" /></button>
          {playlists.map((playlist, index) => (
            <button className="playlist-link" key={playlist.id} onClick={() => setActiveNav(playlist.id)}>
              <span className={`playlist-dot ${["mix-lime", "mix-blue", "mix-pink"][index % 3]}`} />{playlist.name}
            </button>
          ))}
          {!playlists.length && <span className="library-empty">{user ? "Create your first playlist" : "Connect Spotify for your library"}</span>}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-status"><span className="status-light" /> YOUR LITTLE CORNER OF THE INTERNET</div>
          <div className="profile">
            {user?.avatarUrl ? <img className="profile-avatar profile-image" src={user.avatarUrl} alt="" /> : <div className="profile-avatar">{user?.displayName.slice(0, 1).toUpperCase() ?? "G"}</div>}
            <div className="profile-copy"><strong>{user?.displayName ?? "Guest listener"}</strong><span>{user ? "Spotify connected" : "Find your frequency"}</span></div>
            <Ellipsis size={18} className="profile-more" />
          </div>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div className="history-buttons">
            <button className="icon-button history" aria-label="Go back"><ChevronLeft size={18} /></button>
            <button className="icon-button history" aria-label="Go forward"><ChevronRight size={18} /></button>
          </div>
          <label className="search-box">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find your next repeat" aria-label="Search tracks" />
            <kbd>⌘ K</kbd>
          </label>
          {user
            ? <button className="upgrade-button" onClick={() => void logout()}>Disconnect <ChevronRight size={15} /></button>
            : <button className="upgrade-button" onClick={connectSpotify}>Connect Spotify <ChevronRight size={15} /></button>}
        </header>

        <div className="content-scroll">
          <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow"><span className="eyebrow-line" /> YOUR NEXT REPEAT <span className="eyebrow-date">— UPDATED DAILY</span></div>
              <h1>Find your<br /><span>own frequency.</span></h1>
              <p>A little less expected. A lot more you.</p>
              <button className="hero-play" onClick={handleHeroPlay}>
                {isLoadingTrack ? <AudioLines size={16} /> : isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                {isLoadingTrack ? "Cancel tuning" : isPlaying ? "Pause your mix" : currentTrack.playable ? "Play your mix" : "Search open audio"}
              </button>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
              <div className="hero-sun" />
              <div className="hero-disc"><span className="disc-center" /><span className="disc-label">SIDE<br />A</span></div>
              <AudioVisualizer />
              <div className="hero-spark spark-one"><Sparkles size={21} strokeWidth={1.4} /></div><div className="hero-spark spark-two"><Sparkles size={15} strokeWidth={1.4} /></div>
              <div className="hero-sticker">SIDE A<br />ON REPEAT</div>
              <div className="hero-caption">good sound<br />finds you <span>↗</span></div>
            </div>
            <div className="hero-index">01 <span>/</span> 04</div>
          </section>
          {(apiError || queryError || playerError) && <p className="app-error" role="status">{apiError || queryError || playerError}</p>}

          <section className="section-block">
            <div className="section-heading">
              <div><div className="section-kicker">{searchSource === "open-audio" ? "INTERNET ARCHIVE / OPEN-LICENSE AUDIO" : "MUSICBRAINZ / COVER ART ARCHIVE"}</div><h2>{query ? "Search results" : "Your next little obsession"}<span>.</span></h2></div>
              <button className="text-button" onClick={() => document.querySelector<HTMLInputElement>(".search-box input")?.focus()}>Search the catalog <ChevronRight size={15} /></button>
            </div>
            <div className="catalog-source-tabs" role="tablist" aria-label="Catalog source">
              <button role="tab" aria-selected={searchSource === "open-audio"} className={searchSource === "open-audio" ? "active" : ""} onClick={() => setSearchSource("open-audio")}>Streamable open audio</button>
              <button role="tab" aria-selected={searchSource === "metadata"} className={searchSource === "metadata" ? "active" : ""} onClick={() => setSearchSource("metadata")}>All music metadata</button>
            </div>
            {searchSource === "open-audio" && <p className="catalog-source-note">Only public audio with approved CC BY, CC BY-SA, CC0, or public-domain licenses is included.</p>}
            <div className="mood-row" role="tablist" aria-label="Filter by genre">
              {["All sounds", ...Array.from(new Set(tracks.flatMap((track) => track.genres)))].map((mood) => (
                <button key={mood} role="tab" aria-selected={activeMood === mood} className={`mood-chip ${activeMood === mood ? "active" : ""}`} onClick={() => setActiveMood(mood)}>{mood}</button>
              ))}
            </div>
            <div className="track-grid">
              {isLoading ? <div className="empty-state">TUNING INTO YOUR FREQUENCY…</div> : visibleTracks.length ? visibleTracks.map((track, index) => (
                <div className={`track-card ${currentTrack.id === track.id && isPlaying ? "is-current" : ""}`} key={track.id}>
                  <button className="track-card-select" onClick={() => playTrack(track)} aria-label={`Play ${track.title} by ${track.artist}`}>
                    <div className="track-cover-wrap">
                      <Cover track={track} />
                      <span className="track-play"><Play size={17} fill="currentColor" /></span>
                      <span className="track-number">{String(index + 1).padStart(2, "0")}</span>
                      {!track.playable && <span className="track-unavailable">NO STREAMING SOURCE</span>}
                    </div>
                    <span className="track-card-title">{track.title}</span>
                    <span className="track-card-artist">{track.artist}</span>
                    <span className="track-card-album">{track.album} · {track.duration}</span>
                  </button>
                  {track.audioLicenseUrl && track.archiveIdentifier && (
                    <span className="track-license">
                      <a href={`https://archive.org/details/${encodeURIComponent(track.archiveIdentifier)}`} target="_blank" rel="noreferrer">Internet Archive</a>
                      {" · "}
                      <a href={track.audioLicenseUrl} target="_blank" rel="noreferrer">View license</a>
                    </span>
                  )}
                </div>
              )) : <div className="empty-state">{query ? searchSource === "open-audio" ? "No openly licensed audio found. Try a different search." : "No catalog tracks found. Try a different search." : "Search the catalog to discover music."}</div>}
            </div>
          </section>

          <section className="section-block mix-section">
            <div className="section-heading">
              <div><div className="section-kicker">YOUR MUSIC, YOUR WAY</div><h2>Made for your many moods<span>.</span></h2></div>
              <button className="text-button" onClick={() => void createPlaylist()}>Create a playlist <ChevronRight size={15} /></button>
            </div>
            <div className="mix-grid">
              {playlists.map((playlist, index) => (
                <button className={`mix-card ${["mix-lime", "mix-blue", "mix-pink"][index % 3]}`} key={playlist.id} onClick={() => setActiveNav(playlist.id)}>
                  <div className="mix-art">
                    <span className="mix-orb" /><span className="mix-ring" /><span className="mix-art-index">FQ / 0{index + 1}</span>
                    <span className="mix-art-label">{playlist.name.split(" ").map((word) => <span key={word}>{word}</span>)}</span>
                    <span className="mix-art-stamp"><Sparkles size={14} /></span>
                  </div>
                  <span className="mix-name">{playlist.name}</span>
                  <span className="mix-description">{playlist.description ?? "Your own collection"} <span>·</span> {playlist.items.length} tracks</span>
                </button>
              ))}
              <button className="mix-card create-card" onClick={() => void createPlaylist()}>
                <span className="create-icon"><CirclePlus size={26} strokeWidth={1.4} /></span>
                <span className="mix-name">Your next thing</span>
                <span className="mix-description">Start a playlist from scratch</span>
              </button>
              {!playlists.length && <div className="playlist-empty">{user ? "Your playlists will show up here." : "Sign in with Spotify to create and save playlists."}</div>}
            </div>
          </section>

          <section className="listening-note">
            <div className="note-icon"><Mic2 size={17} /></div>
            <div><span className="section-kicker">THE FREAKUENCY DIFFERENCE</span><p>Good music has a way of finding you. <strong>We just get out of its way.</strong></p></div>
            <div className="note-right">CURATED BY PEOPLE, NOT JUST PATTERNS <span>↗</span></div>
          </section>
          <footer className="footer">
            <span>FREAKUENCY® — FIND YOUR FREQUENCY</span>
            <span>INDEPENDENT TASTE. INFINITE REPLAY.</span>
            <span className="catalog-attribution">
              Metadata: <a href="https://musicbrainz.org" target="_blank" rel="noreferrer">MusicBrainz</a>
              {" · "}Artwork: <a href="https://coverartarchive.org" target="_blank" rel="noreferrer">Cover Art Archive</a>
              {" · "}Open audio: <a href="https://archive.org" target="_blank" rel="noreferrer">Internet Archive</a>
            </span>
          </footer>
        </div>
      </section>

      <aside className="right-rail">
        <div className="rail-top"><span className="rail-label">ON THE RADAR</span><button className="icon-button small" aria-label="More radar options"><Ellipsis size={17} /></button></div>
        <div className="radar-feature">
          <div className="radar-art">
            <div className="radar-sun" /><div className="radar-record"><span /></div>
            <span className="radar-tag">FQ PICK / 06</span>
            <span className="radar-type">THE<br />SLOW<br />BURN</span>
          </div>
          <div className="radar-copy">
            <span className="section-kicker">A DEEPER LISTEN</span>
            <h3>Some songs<br />stick around.</h3>
            <p>A monthly-ish dive into sounds that don’t need to shout.</p>
            <button className="radar-link" onClick={() => tracks[0] ? playTrack(tracks[0]) : connectSpotify()}>Take a listen <ChevronRight size={14} /></button>
          </div>
        </div>
        <div className="rail-divider" />
        <div className="rail-section-heading"><span className="rail-label">YOUR RECENT SPINS</span><button className="rail-view" onClick={() => setActiveNav("History")}>VIEW ALL</button></div>
        <div className="recent-list">
          {tracks.slice(-4).reverse().map((track, index) => (
            <button className="recent-item" key={`${track.title}-${index}`} onClick={() => playTrack(track)}>
              <Cover track={track} className="recent-cover" />
              <span className="recent-info"><strong>{track.title}</strong><span>{track.artist}</span></span>
              <span className="recent-time">{["2m", "18m", "1h", "3h"][index]}</span>
            </button>
          ))}
          {!tracks.length && <div className="recent-empty">Search for tracks to start your history.</div>}
        </div>
        <div className="rail-divider second-divider" />
        <div className="queue-heading"><div><span className="rail-label">UP NEXT, MAYBE</span><p>A very loose plan.</p></div><button className="icon-button small" aria-label="Open queue"><Maximize2 size={15} /></button></div>
        <div className="queue-preview">
          <div className="queue-bars"><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
          <div><strong>{queuedTrack?.title ?? "Nothing is set in stone."}</strong><span>{queuedTrack?.artist ?? "That’s kind of the point."}</span></div>
        </div>
        <div className="rail-bottom-note"><Disc3 size={15} /><span>IN GOOD COMPANY<br /><strong>2,418 listeners around</strong></span><span className="listener-dots"><i /><i /><i /></span></div>
      </aside>

      <footer className="player">
        <div className="now-playing">
          <Cover track={currentTrack} className="player-cover" />
          <div className="now-playing-copy"><strong>{currentTrack.title}</strong><span>{currentTrack.artist}</span></div>
          <button className={`icon-button like-button ${liked ? "liked" : ""}`} aria-label={liked ? "Unlike track" : "Like track"} onClick={() => void toggleFavorite()}><Heart size={17} fill={liked ? "currentColor" : "none"} /></button>
          <button className="icon-button player-more" aria-label="More track options"><Ellipsis size={18} /></button>
        </div>
        <div className="player-center">
          <div className="player-controls">
            <button className={`control-button secondary-control ${isShuffled ? "shuffle-active" : ""}`} aria-label="Shuffle" aria-pressed={isShuffled} onClick={toggleShuffle}><Shuffle size={15} /></button>
            <button className="control-button" aria-label="Previous track" onClick={() => moveTrack(-1)}><SkipBack size={17} fill="currentColor" /></button>
            <button className="main-control" aria-label={isLoadingTrack ? "Cancel loading" : isPlaying ? "Pause" : "Play"} onClick={togglePlayback}>{isLoadingTrack ? <Pause size={17} fill="currentColor" /> : isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
            <button className="control-button" aria-label="Next track" onClick={() => moveTrack(1)}><SkipForward size={17} fill="currentColor" /></button>
            <button className="control-button secondary-control" aria-label="Play next track" onClick={() => moveTrack(1)}><ListMusic size={16} /></button>
          </div>
          <div className="progress-row">
            <span>{formatPlaybackTime(currentTime)}</span>
            <input
              className="progress-slider"
              type="range"
              min="0"
              max={playbackDuration}
              step="0.1"
              value={Math.min(currentTime, playbackDuration)}
              aria-label="Seek playback"
              onChange={(event) => seekTo(Number(event.target.value))}
              style={{ "--progress": `${playbackProgress}%` } as React.CSSProperties}
            />
            <span>{formatPlaybackTime(duration || currentTrack.durationMs / 1000)}</span>
          </div>
        </div>
        <div className="player-options"><button className="control-button lyrics-button" aria-label="Lyrics"><Mic2 size={16} /></button><Volume2 size={17} /><input className="player-volume" type="range" min="0" max="1" step="0.01" value={volume} aria-label="Volume" onChange={(event) => setVolume(Number(event.target.value))} style={{ "--volume": `${volume * 100}%` } as React.CSSProperties} /><button className="control-button expand-button" aria-label="Expand player"><Maximize2 size={15} /></button></div>
        <div className="player-live"><span className={isPlaying ? "playing-bars" : "paused-bars"}><i /><i /><i /><i /></span><span>{isLoadingTrack ? "TUNING IN" : isPlaying ? "IN THE MOMENT" : "READY WHEN YOU ARE"}</span></div>
      </footer>
    </main>
  );
}
