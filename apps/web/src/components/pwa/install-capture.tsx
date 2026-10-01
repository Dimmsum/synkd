'use client';

// Importing the store adds the `beforeinstallprompt` and `appinstalled` listeners as soon as the
// client bundle runs (WF-111). Kept apart from the prompt UI so every page only pays for this.
import './install-store';

/** Mounted once in the root layout so the install prompt is caught on every page. */
export function InstallCapture() {
  return null;
}
