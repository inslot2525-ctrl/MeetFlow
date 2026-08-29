import React from "react";

export function DarkGradientBg({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`${className} bg-[#0a0a0a] bg-gradient-to-br from-[#0a0a0a] via-[#111827] to-[#0f172a] min-h-screen`}>
      {children}
    </div>
  );
}
