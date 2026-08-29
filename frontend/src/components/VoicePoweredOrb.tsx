import { useRef } from "react";

export function VoicePoweredOrb({ hue = 180, voiceSensitivity = 2.0, active = true }: { hue?: number; voiceSensitivity?: number; active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  // Simple pulsing orb — replace with canvas/audio analyser later
  return (
    <div
      ref={ref}
      className={`w-full h-full rounded-full ${active ? "animate-pulse" : "opacity-40"}`}
      style={{
        background: `radial-gradient(circle at 30% 30%, hsl(${hue} 100% 70%), hsl(${hue} 80% 40%) 60%, hsl(${hue} 60% 20%))`,
        boxShadow: `0 0 30px hsl(${hue} 100% 50% / 0.6)`,
        transform: active ? `scale(${1 + 0.04 * voiceSensitivity})` : undefined,
        transition: "transform 0.3s ease",
      }}
      aria-label="Voice orb"
    />
  );
}
