"use client";

import { useEffect, useRef } from "react";
import { usePlayerStore } from "../lib/player-store";

export function AudioVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyser = usePlayerStore((state) => state.analyser);
  const isPlaying = usePlayerStore((state) => state.isPlaying);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio));
      canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const frequencies = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const gradient = context.createLinearGradient(0, 0, canvas.clientWidth, 0);
    gradient.addColorStop(0, "#9bd7f4");
    gradient.addColorStop(1, "#ffb47d");
    let animationFrame = 0;

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      context.clearRect(0, 0, width, height);
      if (analyser && frequencies && isPlaying) analyser.getByteFrequencyData(frequencies);

      const barCount = 36;
      const gap = 3;
      const barWidth = Math.max(1, (width - gap * (barCount - 1)) / barCount);
      for (let index = 0; index < barCount; index += 1) {
        const magnitude = analyser && frequencies && isPlaying
          ? frequencies[Math.floor(index * frequencies.length / barCount)] / 255
          : 0;
        const barHeight = Math.max(2, magnitude * height * 0.82);
        const x = index * (barWidth + gap);
        context.globalAlpha = magnitude ? 0.48 + magnitude * 0.52 : 0.18;
        context.fillStyle = gradient;
        context.fillRect(x, (height - barHeight) / 2, barWidth, barHeight);
      }
      context.globalAlpha = 1;

      if (isPlaying && analyser) animationFrame = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [analyser, isPlaying]);

  return <canvas className="audio-visualizer" ref={canvasRef} aria-hidden="true" />;
}
