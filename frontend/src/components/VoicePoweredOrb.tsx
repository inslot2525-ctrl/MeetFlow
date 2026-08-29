"use client";

import { useEffect, useRef, useState } from "react";

export function VoicePoweredOrb({
  hue = 180,
  voiceSensitivity = 2.0,
  active = true,
  audioStream,
}: {
  hue?: number;
  voiceSensitivity?: number;
  active?: boolean;
  audioStream?: MediaStream | null;
}) {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const dataArrayRef = useRef<any>(null);

  // Initialize analyser when stream provided
  useEffect(() => {
    if (!audioStream || !active) {
      setLevel(0);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      return;
    }
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextCtor();
    ctxRef.current = ctx;
    const source = ctx.createMediaStreamSource(audioStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.85;
    source.connect(analyser);
    analyserRef.current = analyser;
    dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount) as unknown as Uint8Array;

    const tick = () => {
      if (!analyserRef.current || !dataArrayRef.current) return;
      (analyserRef.current as any).getByteFrequencyData(dataArrayRef.current);
      // Average of first few bins (low freq ~ voice)
      let sum = 0;
      for (let i = 0; i < 8; i++) sum += dataArrayRef.current[i];
      const avg = sum / 8; // 0-255
      setLevel(Math.min(1, avg / 80)); // normalize, cap
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      try { source.disconnect(); analyser.disconnect(); ctx.close(); } catch {}
    };
  }, [audioStream, active]);

  // Pulse scale based on level + sensitivity
  const pulseScale = active ? 1 + (level * 0.15 * voiceSensitivity) : 1;
  const glowIntensity = active ? 0.3 + level * 0.7 : 0.2;

  // Inject keyframes once
  useEffect(() => {
    const styleId = "voice-orb-keyframes";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes voice-orb-breathe {
        0%, 100% { transform: scale(1); opacity: 0.4; }
        50% { transform: scale(1.12); opacity: 0.9; }
      }
    `;
    document.head.appendChild(style);
    return () => { try { document.head.removeChild(style); } catch {} };
  }, []);

  return (
    <div
      className="w-full h-full rounded-full relative overflow-hidden"
      style={{
        transform: `scale(${pulseScale})`,
        transition: "transform 0.08s linear, box-shadow 0.08s linear",
        background: `radial-gradient(circle at 30% 30%, hsl(${hue} 100% 70%), hsl(${hue} 80% 40%) 60%, hsl(${hue} 60% 15%))`,
        boxShadow: `0 0 ${20 + level * 40}px hsl(${hue} 100% 50% / ${glowIntensity}), inset 0 0 ${10 + level * 20}px hsl(${hue} 100% 50% / ${level * 0.3})`,
      }}
      aria-label="Voice activity"
    >
      {/* Inner breathing ring */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          border: `2px solid hsl(${hue} 100% 60% / ${0.2 + level * 0.5})`,
          animation: active ? "voice-orb-breathe 2.5s ease-in-out infinite" : "none",
          opacity: active ? 1 : 0.4,
        }}
      />
      {/* Center dot */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
        style={{
          background: `hsl(${hue} 100% 60%)`,
          boxShadow: `0 0 ${4 + level * 8}px hsl(${hue} 100% 50% / ${0.8 + level * 0.2})`,
          transform: `scale(${1 + level * 0.4})`,
          transition: "transform 0.08s linear, box-shadow 0.08s linear",
        }}
      />
    </div>
  );
}