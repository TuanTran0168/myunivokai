"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2, Plus, Sparkles, Wand2 } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import { addWorldIdentifierToGallery } from "@/lib/savedWorlds";
import { UniverseCanvas } from "@/components/UniverseCanvas";
import { GeneratingOverlay } from "@/components/GeneratingOverlay";
import { StatusMessage } from "@/components/StatusMessage";
import { buildPreviewSceneConfig } from "@/lib/scene";

const interestOptions = ["Technology", "Art", "Science", "Design", "Music", "AI", "Storytelling", "Product"];
const traitOptions = ["curious", "builder", "focused", "creative", "calm", "explorer"];
const moodOptions = [
  { label: "Cybernetic", value: "focused", gradient: "from-[#0f172a] to-[#3b82f6]" },
  { label: "Nebula", value: "dreamy", gradient: "from-[#1e1b4b] to-[#a855f7]" },
  { label: "Solar", value: "energetic", gradient: "from-[#422006] to-[#eab308]" },
  { label: "Void", value: "reflective", gradient: "from-[#450a0a] to-[#ef4444]" }
];
const styleOptions = [
  { label: "Cosmic", value: "cosmic-galaxy", gradient: "from-[#1e1b4b] to-[#8B5CF6]" },
  { label: "Nebula", value: "nebula", gradient: "from-[#1e1b4b] to-[#a855f7]" },
  { label: "Crystal", value: "crystal", gradient: "from-[#0c4a6e] to-[#22d3ee]" },
  { label: "Aurora", value: "aurora", gradient: "from-[#064e3b] to-[#34d399]" },
  { label: "Cyber Orbit", value: "cyber-orbit", gradient: "from-[#082f49] to-[#38bdf8]" }
];
const colorOptions = ["#8B5CF6", "#06B6D4", "#F97316", "#22C55E", "#F43F5E", "#EAB308"];

// The live preview rebuilds the WebGL scene whenever its inputs change. Debounce
// so a burst of keystrokes/toggles only rebuilds the canvas once the user pauses,
// instead of tearing down and recreating the GL context on every character.
const PREVIEW_REBUILD_DEBOUNCE_MILLISECONDS = 300;

function useDebouncedValue<ValueType>(value: ValueType, delayMilliseconds: number): ValueType {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timeoutId = setTimeout(() => setDebouncedValue(value), delayMilliseconds);
    return () => clearTimeout(timeoutId);
  }, [value, delayMilliseconds]);
  return debouncedValue;
}

function toggleItem(current: string[], item: string, min: number, max: number) {
  if (current.includes(item)) {
    return current.length <= min ? current : current.filter((value) => value !== item);
  }
  return current.length >= max ? current : [...current, item];
}

function ensureRange(values: string[], defaults: string[], min: number, max: number) {
  const merged = [...values, ...defaults].map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set(merged)).slice(0, max).slice(0, Math.max(min, Math.min(max, merged.length)));
}

export default function HomePage() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [role, setRole] = useState("");
  const [goal, setGoal] = useState("");
  const [challenge, setChallenge] = useState("");
  const [interests, setInterests] = useState(["Technology", "Design", "AI"]);
  const [traits, setTraits] = useState(["curious", "builder", "focused"]);
  const [mood, setMood] = useState("focused");
  const [preferredWorldStyle, setPreferredWorldStyle] = useState("cosmic-galaxy");
  const [favoriteColors, setFavoriteColors] = useState<string[]>(["#8B5CF6", "#06B6D4"]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const payload = useMemo(() => {
    const safeInterests = ensureRange(interests, ["Technology", "Design", "AI"], 3, 8);
    const safeTraits = ensureRange(traits, ["curious", "builder", "focused"], 3, 6);
    const safeGoal =
      goal.trim() ||
      `Build a personal universe around ${safeInterests.slice(0, 3).join(", ")} with a ${safeTraits[0]} energy.`;

    return {
      nickname: nickname.trim() || "Neo",
      role: role.trim() || "Explorer",
      interests: safeInterests,
      traits: safeTraits,
      goal: safeGoal.slice(0, 220),
      challenge: challenge.trim() || undefined,
      mood,
      favoriteColors: favoriteColors.length ? favoriteColors : ["#8B5CF6"],
      preferredWorldStyle
    };
  }, [challenge, favoriteColors, goal, interests, mood, nickname, preferredWorldStyle, role, traits]);

  // Built from the same sanitized payload that is submitted (not the raw form
  // state) so the preview's planet count and names match the generated world,
  // and debounced so typing does not rebuild the canvas on every keystroke.
  const debouncedPayload = useDebouncedValue(payload, PREVIEW_REBUILD_DEBOUNCE_MILLISECONDS);
  const previewScene = useMemo(
    () =>
      buildPreviewSceneConfig({
        nickname: debouncedPayload.nickname,
        interests: debouncedPayload.interests,
        traits: debouncedPayload.traits,
        mood: debouncedPayload.mood,
        preferredWorldStyle: debouncedPayload.preferredWorldStyle,
        favoriteColors: debouncedPayload.favoriteColors
      }),
    [debouncedPayload]
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const world = await api.createWorld(payload);
      addWorldIdentifierToGallery(world.id);
      router.push(`/worlds/${world.id}`);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function toggleColor(color: string) {
    setFavoriteColors((current) => toggleItem(current, color, 1, 4));
  }

  return (
    <main className="relative min-h-[calc(100vh-57px)] overflow-hidden px-4 py-8 sm:px-6 lg:px-12">
      <GeneratingOverlay isVisible={loading} />
      <div className="pointer-events-none absolute left-[-120px] top-6 h-[420px] w-[420px] rounded-full bg-primary-container/20 blur-[90px]" />
      <div className="pointer-events-none absolute bottom-[-180px] right-[-120px] h-[560px] w-[560px] rounded-full bg-secondary/15 blur-[90px]" />

      <div className="relative z-10 mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col items-center">
          <div className="relative flex w-full max-w-2xl items-center justify-between">
            <div className="absolute left-0 top-4 h-px w-full bg-white/10" />
            <div className="absolute left-0 top-4 h-0.5 w-1/3 bg-gradient-to-r from-primary-container to-secondary shadow-cyan" />
            {["Identity", "Traits", "Finalize"].map((step, index) => (
              <div key={step} className="relative flex flex-col items-center gap-2">
                <div
                  className={`grid h-8 w-8 place-items-center rounded-full border text-sm font-semibold ${
                    index === 0
                      ? "border-primary bg-surface-high text-primary shadow-glow"
                      : index === 1
                        ? "border-primary-container bg-primary-container text-[#23005c]"
                        : "border-white/10 bg-surface-high text-on-surface-variant"
                  }`}
                >
                  {index + 1}
                </div>
                <span className="font-mono text-xs uppercase tracking-widest text-on-surface-variant">{step}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          <section className="glass-panel rounded-2xl p-5 sm:p-8 lg:col-span-7">
            <div className="mb-7">
              <div className="mb-2 flex items-center gap-2 text-secondary">
                <Wand2 className="h-5 w-5" aria-hidden="true" />
                <span className="font-mono text-xs uppercase tracking-widest">Create Universe</span>
              </div>
              <h1 className="font-display text-4xl font-bold tracking-wide text-primary sm:text-5xl">Define Your Core</h1>
              <p className="mt-3 text-on-surface-variant">Input parameters to initialize your personal 3D data space.</p>
            </div>

            <form className="grid gap-5" onSubmit={onSubmit}>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="font-mono text-xs uppercase tracking-widest text-on-surface-variant">Nickname</span>
                  <input
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    className="focus-ring input-dark rounded-xl px-4 py-3 text-on-surface placeholder:text-outline"
                    placeholder="e.g. Neo"
                    maxLength={32}
                  />
                </label>
                <label className="grid gap-2">
                  <span className="font-mono text-xs uppercase tracking-widest text-on-surface-variant">Primary Role</span>
                  <input
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                    className="focus-ring input-dark rounded-xl px-4 py-3 text-on-surface placeholder:text-outline"
                    placeholder="e.g. Explorer, Creator"
                    maxLength={80}
                  />
                </label>
              </div>

              <div className="grid gap-3">
                <span className="font-mono text-xs uppercase tracking-widest text-on-surface-variant">Core Interests</span>
                <div className="flex flex-wrap gap-2">
                  {interestOptions.map((item) => {
                    const selected = interests.includes(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setInterests((current) => toggleItem(current, item, 3, 8))}
                        className={`focus-ring rounded-full border px-4 py-1.5 text-sm transition ${
                          selected
                            ? "border-primary/50 bg-primary/20 text-primary shadow-glow"
                            : "border-white/10 bg-surface-bright text-on-surface-variant hover:border-white/30"
                        }`}
                      >
                        {item}
                      </button>
                    );
                  })}
                  <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/15 bg-surface-bright px-4 py-1.5 text-sm text-outline">
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Custom
                  </span>
                </div>
              </div>

              <div className="grid gap-3">
                <span className="font-mono text-xs uppercase tracking-widest text-on-surface-variant">Traits</span>
                <div className="flex flex-wrap gap-2">
                  {traitOptions.map((item) => {
                    const selected = traits.includes(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setTraits((current) => toggleItem(current, item, 3, 6))}
                        className={`focus-ring rounded-full border px-4 py-1.5 text-sm capitalize transition ${
                          selected
                            ? "border-secondary/50 bg-secondary/15 text-secondary shadow-cyan"
                            : "border-white/10 bg-surface-bright text-on-surface-variant hover:border-white/30"
                        }`}
                      >
                        {item}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="grid gap-2">
                <span className="font-mono text-xs uppercase tracking-widest text-on-surface-variant">Goal</span>
                <textarea
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  className="focus-ring input-dark min-h-24 resize-y rounded-xl px-4 py-3 text-on-surface placeholder:text-outline"
                  placeholder="Build a beautiful AI product that feels personal and useful."
                  maxLength={220}
                />
              </label>

              <label className="grid gap-2">
                <span className="font-mono text-xs uppercase tracking-widest text-on-surface-variant">Hidden Challenge</span>
                <input
                  value={challenge}
                  onChange={(event) => setChallenge(event.target.value)}
                  className="focus-ring input-dark rounded-xl px-4 py-3 text-on-surface placeholder:text-outline"
                  placeholder="e.g. I overthink product direction"
                  maxLength={220}
                />
              </label>

              <div className="grid gap-3">
                <span className="font-mono text-xs uppercase tracking-widest text-on-surface-variant">Atmospheric Mood</span>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {moodOptions.map((option) => {
                    const selected = mood === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setMood(option.value)}
                        aria-pressed={selected}
                        className={`focus-ring glass-panel relative rounded-xl border-2 p-3 text-center transition ${
                          selected
                            ? "scale-[1.03] border-secondary bg-secondary/15 shadow-cyan ring-2 ring-secondary/40"
                            : "border-transparent hover:border-white/20"
                        }`}
                      >
                        {selected ? (
                          <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-secondary text-[#001b1b]">
                            <Check className="h-3 w-3" aria-hidden="true" />
                          </span>
                        ) : null}
                        <span className={`mb-2 block h-8 rounded bg-gradient-to-r ${option.gradient}`} />
                        <span className={`text-sm ${selected ? "font-semibold text-secondary" : "text-on-surface"}`}>
                          {option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3">
                <span className="font-mono text-xs uppercase tracking-widest text-on-surface-variant">World Style</span>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                  {styleOptions.map((option) => {
                    const selected = preferredWorldStyle === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setPreferredWorldStyle(option.value)}
                        aria-pressed={selected}
                        className={`focus-ring glass-panel relative rounded-xl border-2 p-3 text-center transition ${
                          selected
                            ? "scale-[1.03] border-primary bg-primary/15 shadow-glow ring-2 ring-primary/40"
                            : "border-transparent hover:border-white/20"
                        }`}
                      >
                        {selected ? (
                          <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-[#23005c]">
                            <Check className="h-3 w-3" aria-hidden="true" />
                          </span>
                        ) : null}
                        <span className={`mb-2 block h-8 rounded bg-gradient-to-r ${option.gradient}`} />
                        <span className={`text-sm ${selected ? "font-semibold text-primary" : "text-on-surface"}`}>
                          {option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-2">
                <span className="font-mono text-xs uppercase tracking-widest text-on-surface-variant">Palette</span>
                <div className="flex flex-wrap gap-2">
                  {colorOptions.map((color) => {
                    const selected = favoriteColors.includes(color);
                    return (
                      <button
                        key={color}
                        type="button"
                        title={color}
                        aria-label={color}
                        aria-pressed={selected}
                        onClick={() => toggleColor(color)}
                        className={`focus-ring h-10 w-10 rounded-xl border transition ${selected ? "scale-[1.06] border-primary ring-2 ring-primary/30" : "border-white/15 hover:border-white/30"}`}
                        style={{ backgroundColor: color }}
                      />
                    );
                  })}
                </div>
              </div>

              {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}

              <div className="flex justify-end pt-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="focus-ring btn-gradient inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-8 py-3 font-semibold transition disabled:cursor-wait disabled:opacity-70"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                  Generate My 3D Universe
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </form>
          </section>

          <aside className="grid gap-6 lg:col-span-5">
            <div className="glass-panel flex min-h-[420px] flex-col overflow-hidden rounded-2xl border-secondary/30 shadow-cyan">
              <div className="flex items-center justify-between border-b border-white/5 bg-surface-lowest/50 p-5">
                <div className="flex items-center gap-3">
                  <Sparkles className="h-5 w-5 animate-pulse text-secondary" aria-hidden="true" />
                  <h2 className="font-display text-lg font-semibold tracking-wide text-on-surface">Live DNA Preview</h2>
                </div>
                <span className="font-mono text-xs text-secondary/70">SYNCING...</span>
              </div>
              <UniverseCanvas scene={previewScene} className="min-h-[360px] flex-1" />
            </div>

            <div className="glass-panel rounded-2xl p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-widest text-on-surface-variant">Signature</span>
                <span className="font-mono text-sm text-primary">{payload.interests.slice(0, 2).join("-").toUpperCase()}-01</span>
              </div>
              <div className="mb-3 h-px bg-white/5" />
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-widest text-on-surface-variant">Active Palette</span>
                <div className="flex gap-1">
                  {payload.favoriteColors.map((color) => (
                    <span key={color} className="h-4 w-4 rounded-full border border-white/20" style={{ backgroundColor: color }} />
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
