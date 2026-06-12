const SAVED_WORLD_IDENTIFIERS_STORAGE_KEY = "myunivokai.savedWorldIds";

function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined";
}

export function readSavedWorldIdentifiers(): string[] {
  if (!isBrowserEnvironment()) {
    return [];
  }
  try {
    const storedValue = window.localStorage.getItem(SAVED_WORLD_IDENTIFIERS_STORAGE_KEY);
    if (!storedValue) {
      return [];
    }
    const parsedValue = JSON.parse(storedValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }
    return parsedValue.filter(
      (worldIdentifier): worldIdentifier is string =>
        typeof worldIdentifier === "string" && worldIdentifier.length > 0
    );
  } catch {
    return [];
  }
}

function writeSavedWorldIdentifiers(worldIdentifiers: string[]): void {
  if (!isBrowserEnvironment()) {
    return;
  }
  try {
    window.localStorage.setItem(SAVED_WORLD_IDENTIFIERS_STORAGE_KEY, JSON.stringify(worldIdentifiers));
  } catch {
    // Storage may be unavailable (private mode, quota). Gallery is best-effort.
  }
}

export function addWorldIdentifierToGallery(worldIdentifier: string): void {
  if (!worldIdentifier) {
    return;
  }
  const savedWorldIdentifiers = readSavedWorldIdentifiers();
  if (savedWorldIdentifiers.includes(worldIdentifier)) {
    return;
  }
  writeSavedWorldIdentifiers([worldIdentifier, ...savedWorldIdentifiers]);
}

export function removeWorldIdentifierFromGallery(worldIdentifier: string): void {
  const savedWorldIdentifiers = readSavedWorldIdentifiers();
  writeSavedWorldIdentifiers(
    savedWorldIdentifiers.filter((savedIdentifier) => savedIdentifier !== worldIdentifier)
  );
}
