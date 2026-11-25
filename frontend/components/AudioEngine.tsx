"use client";

import { useEffect } from "react";
import { usePlayerStore } from "../lib/player-store";

export function AudioEngine() {
  const setAudioElement = usePlayerStore((state) => state.setAudioElement);
  const setCurrentTime = usePlayerStore((state) => state.setCurrentTime);
  const setDuration = usePlayerStore((state) => state.setDuration);
  const setEnded = usePlayerStore((state) => state.setEnded);
  const setLoading = usePlayerStore((state) => state.setLoading);
  const setPlaybackError = usePlayerStore((state) => state.setPlaybackError);
  const setAudioContext = usePlayerStore((state) => state.setAudioContext);
  const setAnalyser = usePlayerStore((state) => state.setAnalyser);

  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.preload = "metadata";
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onEnded = () => setEnded();
    const onLoadStart = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    const onWaiting = () => setLoading(!audio.paused);
    const onPlaying = () => setLoading(false);
    const onError = () => {
      const errorCode = audio.error?.code;
      console.error("Authorized audio stream failed to load:", audio.error);
      setPlaybackError(errorCode === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? "This audio format isn't supported by the browser."
        : "The audio stream couldn't be loaded. Please try again.");
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("error", onError);
    setAudioElement(audio);

    let context: AudioContext | null = null;
    try {
      if (typeof window.AudioContext !== "undefined") {
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.82;
        context.createMediaElementSource(audio).connect(analyser);
        analyser.connect(context.destination);
        setAudioContext(context);
        setAnalyser(analyser);
      }
    } catch (error) {
      console.error("Web Audio visualizer could not be initialized:", error);
    }

    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("error", onError);
      setAudioElement(null);
      setAnalyser(null);
      setAudioContext(null);
      if (context && context.state !== "closed") {
        void context.close().catch((error: unknown) => {
          console.error("Web Audio context could not be closed:", error);
        });
      }
    };
  }, [setAudioElement, setCurrentTime, setDuration, setEnded, setLoading, setPlaybackError, setAudioContext, setAnalyser]);

  return null;
}
