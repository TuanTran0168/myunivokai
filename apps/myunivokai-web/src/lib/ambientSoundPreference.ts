const AMBIENT_SOUND_PREFERENCE_STORAGE_KEY = "myunivokai.ambientSoundEnabled";
const AMBIENT_SOUND_ENABLED_VALUE = "true";

// Whether the visitor has asked for world ambience, remembered across visits.
// Storing it is only half the job: a browser will not let a page make sound
// before the visitor has interacted with it, so a stored "on" cannot start
// playback by itself — it only tells the hook to start at the next gesture.
// See useAmbientSoundscape.

function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined";
}

export function readAmbientSoundPreference(): boolean {
  if (!isBrowserEnvironment()) {
    return false;
  }
  try {
    return window.localStorage.getItem(AMBIENT_SOUND_PREFERENCE_STORAGE_KEY) === AMBIENT_SOUND_ENABLED_VALUE;
  } catch {
    // Storage may be unavailable (private mode, quota). Default to silence.
    return false;
  }
}

export function writeAmbientSoundPreference(isEnabled: boolean): void {
  if (!isBrowserEnvironment()) {
    return;
  }
  try {
    if (isEnabled) {
      window.localStorage.setItem(AMBIENT_SOUND_PREFERENCE_STORAGE_KEY, AMBIENT_SOUND_ENABLED_VALUE);
      return;
    }
    window.localStorage.removeItem(AMBIENT_SOUND_PREFERENCE_STORAGE_KEY);
  } catch {
    // Preference is best-effort; failing to persist must not break playback.
  }
}
