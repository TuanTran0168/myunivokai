"use client";

import { Orbit } from "lucide-react";
import type { PlanetSceneConfig } from "@/lib/types";
import { planetIdentityKey } from "@/components/UniverseCanvas";

const ENERGY_BAR_MAXIMUM_VALUE = 100;

type PlanetDetailsPanelProps = {
  planets: PlanetSceneConfig[];
  selectedPlanetKey: string | null;
  onSelectPlanet: (planet: PlanetSceneConfig | null) => void;
};

function clampEnergyValue(energy?: number): number {
  if (typeof energy !== "number" || Number.isNaN(energy)) {
    return 0;
  }
  return Math.max(0, Math.min(ENERGY_BAR_MAXIMUM_VALUE, energy));
}

export function PlanetDetailsPanel({ planets, selectedPlanetKey, onSelectPlanet }: PlanetDetailsPanelProps) {
  if (planets.length === 0) {
    return null;
  }

  const selectedPlanet = planets.find(
    (planet, planetIndex) => planetIdentityKey(planet, planetIndex) === selectedPlanetKey
  );

  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="mb-3 flex items-center gap-2">
        <Orbit className="h-4 w-4 text-secondary" aria-hidden="true" />
        <h2 className="font-display text-base font-semibold text-on-surface">Planets</h2>
      </div>

      <ul className="grid gap-2">
        {planets.map((planet, planetIndex) => {
          const identityKey = planetIdentityKey(planet, planetIndex);
          const isSelected = identityKey === selectedPlanetKey;
          const energyValue = clampEnergyValue(planet.energy);
          return (
            <li key={identityKey}>
              <button
                type="button"
                onClick={() => onSelectPlanet(isSelected ? null : planet)}
                className={`focus-ring w-full rounded-xl border p-3 text-left transition ${
                  isSelected
                    ? "border-primary/50 bg-primary/15 shadow-glow"
                    : "border-white/10 bg-surface-bright hover:border-white/25"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-semibold text-on-surface">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: planet.color ?? "#8B5CF6" }}
                      aria-hidden="true"
                    />
                    {planet.name ?? "Unknown planet"}
                  </span>
                  <span className="font-mono text-xs text-on-surface-variant">{energyValue}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary-container to-secondary"
                    style={{ width: `${energyValue}%` }}
                  />
                </div>
                {isSelected && planet.meaning ? (
                  <p className="mt-3 text-sm leading-6 text-on-surface-variant">{planet.meaning}</p>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
