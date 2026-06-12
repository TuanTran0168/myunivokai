"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

const STATUS_MESSAGE_ROTATION_INTERVAL_MILLISECONDS = 2200;

const GENERATION_STATUS_MESSAGES = [
  "Analyzing your personality profile...",
  "Generating your Personality DNA...",
  "Forging a unique world seed...",
  "Placing planets on their orbits...",
  "Igniting the sun of your universe..."
];

type GeneratingOverlayProps = {
  isVisible: boolean;
};

/**
 * Full-screen transition shown while the backend calls the AI provider and
 * builds the world. Pure CSS animation so it stays smooth during the request.
 */
export function GeneratingOverlay({ isVisible }: GeneratingOverlayProps) {
  const [statusMessageIndex, setStatusMessageIndex] = useState(0);

  useEffect(() => {
    if (!isVisible) {
      setStatusMessageIndex(0);
      return;
    }
    const rotationInterval = setInterval(() => {
      setStatusMessageIndex((currentIndex) => (currentIndex + 1) % GENERATION_STATUS_MESSAGES.length);
    }, STATUS_MESSAGE_ROTATION_INTERVAL_MILLISECONDS);
    return () => clearInterval(rotationInterval);
  }, [isVisible]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-surface-lowest/90 backdrop-blur-md">
      <div className="flex flex-col items-center gap-8 px-6 text-center">
        <div className="relative h-36 w-36">
          <div className="absolute inset-0 animate-[spin_6s_linear_infinite] rounded-full border border-primary/30" />
          <div className="absolute inset-3 animate-[spin_4s_linear_infinite_reverse] rounded-full border border-secondary/40" />
          <div className="absolute inset-0 animate-[spin_6s_linear_infinite]">
            <span className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-primary shadow-glow" />
          </div>
          <div className="absolute inset-3 animate-[spin_4s_linear_infinite_reverse]">
            <span className="absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-secondary shadow-cyan" />
          </div>
          <div className="absolute inset-0 grid place-items-center">
            <span className="h-10 w-10 animate-pulse rounded-full bg-gradient-to-br from-primary to-secondary shadow-glow" />
          </div>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-center gap-2 text-secondary">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <span className="font-mono text-xs uppercase tracking-widest">Creating your universe</span>
          </div>
          <p className="min-h-7 text-lg font-semibold text-on-surface" aria-live="polite">
            {GENERATION_STATUS_MESSAGES[statusMessageIndex]}
          </p>
          <p className="text-sm text-on-surface-variant">This usually takes a few seconds.</p>
        </div>
      </div>
    </div>
  );
}
