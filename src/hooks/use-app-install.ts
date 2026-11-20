'use client';

import { useSyncExternalStore } from 'react';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
const initial = {
  ready: false,
  installed: false,
  ios: false,
  prompt: null as InstallEvent | null,
};
let state = initial;
const listeners = new Set<() => void>();
function update(next: typeof initial) {
  state = next;
  listeners.forEach((listener) => listener());
}
function capture(event: Event) {
  event.preventDefault();
  update({ ...state, prompt: event as InstallEvent });
}
function installed() {
  update({ ...state, installed: true, prompt: null });
}
function subscribe(listener: () => void) {
  if (!listeners.size) {
    const standalone = window.matchMedia('(display-mode: standalone)');
    state = {
      ...state,
      ready: true,
      installed:
        standalone.matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
      ios:
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    };
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installed);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', installed);
    }
  };
}
async function requestInstall() {
  const event = state.prompt;
  if (!event) return null;
  // A browser installation event can only be used once.
  update({ ...state, prompt: null });
  await event.prompt();
  return (await event.userChoice).outcome;
}

/** Shared by the dashboard invitation and settings so navigation never loses the prompt. */
export function useAppInstall() {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => initial
  );
  return { ...snapshot, requestInstall };
}
