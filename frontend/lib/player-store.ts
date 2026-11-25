import { create } from "zustand";
import type { ApiTrack } from "./api";

export type PlayerTrack = ApiTrack & {
  streamUrl?: string;
};

type PlayerState = {
  currentTrack: PlayerTrack | null;
  queue: PlayerTrack[];
  queueIndex: number;
  isShuffled: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  error: string | null;
  analyser: AnalyserNode | null;
  audioContext: AudioContext | null;
  setAudioElement: (audio: HTMLAudioElement | null) => void;
  setAudioContext: (context: AudioContext | null) => void;
  setAnalyser: (analyser: AnalyserNode | null) => void;
  setQueue: (queue: PlayerTrack[], selectedTrackId: string) => void;
  skipTrack: (direction: -1 | 1) => void;
  toggleShuffle: () => void;
  playTrack: (track: PlayerTrack) => void;
  togglePlayback: () => void;
  setCurrentTime: (currentTime: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  seekTo: (time: number) => void;
  setLoading: (isLoading: boolean) => void;
  setPlaybackError: (error: string) => void;
  setEnded: () => void;
};

let audioElement: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let playbackRequestId = 0;

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  queue: [],
  queueIndex: -1,
  isShuffled: false,
  isPlaying: false,
  isLoading: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  error: null,
  analyser: null,
  audioContext: null,
  setAudioElement: (audio) => {
    playbackRequestId += 1;
    audioElement = audio;
    if (audio) audio.volume = get().volume;
    else set({ isPlaying: false, isLoading: false });
  },
  setAudioContext: (context) => {
    audioContext = context;
    set({ audioContext: context });
  },
  setAnalyser: (analyser) => set({ analyser }),
  setQueue: (queue, selectedTrackId) => {
    const selectedIndex = queue.findIndex((track) => track.id === selectedTrackId);
    set({ queue, queueIndex: selectedIndex >= 0 ? selectedIndex : 0 });
  },
  skipTrack: (direction) => {
    const { queue, queueIndex, isShuffled } = get();
    if (!queue.length) return;
    const nextIndex = isShuffled && queue.length > 1
      ? (queueIndex + 1 + Math.floor(Math.random() * (queue.length - 1))) % queue.length
      : (queueIndex + direction + queue.length) % queue.length;
    set({ queueIndex: nextIndex });
    get().playTrack(queue[nextIndex]);
  },
  toggleShuffle: () => set((state) => ({ isShuffled: !state.isShuffled })),
  playTrack: (track) => {
    const requestId = ++playbackRequestId;
    if (!track.playable || !track.streamUrl) {
      audioElement?.pause();
      set({ currentTrack: track, isPlaying: false, isLoading: false, currentTime: 0, duration: track.durationMs / 1000, error: "No licensed audio file is available for this track yet." });
      return;
    }
    if (!audioElement) {
      set({ currentTrack: track, isPlaying: false, isLoading: false, error: "The audio player is still initializing. Try again in a moment." });
      return;
    }
    audioElement.src = track.streamUrl;
    audioElement.load();
    audioElement.volume = get().volume;
    set({ currentTrack: track, currentTime: 0, duration: track.durationMs / 1000, isPlaying: false, isLoading: true, error: null });
    void audioContext?.resume().catch((error: unknown) => {
      console.error("Web Audio context could not resume:", error);
    });
    void audioElement.play().then(() => {
      if (requestId === playbackRequestId) set({ isPlaying: true, isLoading: false });
    }).catch((error: unknown) => {
      console.error("Browser could not start authorized track playback:", error);
      if (requestId !== playbackRequestId) return;
      set({ isPlaying: false, isLoading: false, error: "The browser couldn't start playback. Try pressing play again." });
    });
  },
  togglePlayback: () => {
    const { currentTrack, isPlaying, isLoading } = get();
    if (!currentTrack) {
      set({ error: "Search for a track to get started." });
      return;
    }
    if (!currentTrack.playable || !currentTrack.streamUrl || !audioElement) {
      set({ isPlaying: false, isLoading: false, error: "This track has no licensed audio file available for playback." });
      return;
    }
    if (isLoading && !isPlaying) {
      playbackRequestId += 1;
      audioElement.pause();
      set({ isLoading: false });
      return;
    }
    if (isPlaying) {
      playbackRequestId += 1;
      audioElement.pause();
      set({ isPlaying: false, isLoading: false });
      return;
    }
    const requestId = ++playbackRequestId;
    void audioContext?.resume().catch((error: unknown) => {
      console.error("Web Audio context could not resume:", error);
    });
    set({ isLoading: true });
    void audioElement.play().then(() => {
      if (requestId === playbackRequestId) set({ isPlaying: true, isLoading: false, error: null });
    }).catch((error: unknown) => {
      console.error("Browser could not resume authorized track playback:", error);
      if (requestId !== playbackRequestId) return;
      set({ isPlaying: false, isLoading: false, error: "The browser couldn't resume playback." });
    });
  },
  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => {
    const boundedVolume = Math.max(0, Math.min(1, volume));
    if (audioElement) audioElement.volume = boundedVolume;
    set({ volume: boundedVolume });
  },
  seekTo: (time) => {
    if (!audioElement || !Number.isFinite(time)) return;
    const boundedTime = Math.max(0, Math.min(time, get().duration));
    audioElement.currentTime = boundedTime;
    set({ currentTime: boundedTime });
  },
  setLoading: (isLoading) => set({ isLoading }),
  setPlaybackError: (error) => set({ error, isLoading: false, isPlaying: false }),
  setEnded: () => {
    if (get().queue.length > 1) {
      get().skipTrack(1);
      return;
    }
    set({ isPlaying: false, isLoading: false, currentTime: 0 });
  },
}));
