import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type CameraSource = 'builtin' | 'external';

const CAMERA_SOURCE_KEY_PREFIX = 'cameraSource_';
const CAMERA_SOURCE_CHANGED = 'bambuddy-camera-source-changed';

export function printerHasExternalCamera(printer?: {
  external_camera_enabled?: boolean;
  external_camera_url?: string | null;
} | null): boolean {
  return Boolean(printer?.external_camera_enabled && printer?.external_camera_url);
}

export function isCameraSource(value: unknown): value is CameraSource {
  return value === 'builtin' || value === 'external';
}

export function cameraSourceStorageKey(printerId: number): string {
  return `${CAMERA_SOURCE_KEY_PREFIX}${printerId}`;
}

export function readStoredCameraSource(printerId: number): CameraSource | null {
  try {
    const saved = localStorage.getItem(cameraSourceStorageKey(printerId));
    return isCameraSource(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function storeCameraSource(printerId: number, source: CameraSource): void {
  try {
    localStorage.setItem(cameraSourceStorageKey(printerId), source);
  } catch {
    // Private mode / quota: the pick still applies for this session.
  }
  window.dispatchEvent(
    new CustomEvent(CAMERA_SOURCE_CHANGED, { detail: { printerId, source } }),
  );
}

/** Last pick for this printer, or external when that camera exists and nothing is stored. */
export function resolveCameraSource(printerId: number, hasExternalCamera: boolean): CameraSource {
  if (!hasExternalCamera) return 'builtin';
  return readStoredCameraSource(printerId) ?? 'external';
}

/**
 * Overlay, /camera popup and cam-wall tiles share one per-printer localStorage
 * key so the last Built-in/External choice survives close/reopen.
 */
export function usePersistedCameraSource(printerId: number, hasExternalCamera: boolean) {
  const [selectedSource, setSelectedSource] = useState<CameraSource>(() =>
    resolveCameraSource(printerId, hasExternalCamera),
  );

  useEffect(() => {
    setSelectedSource(resolveCameraSource(printerId, hasExternalCamera));
  }, [printerId, hasExternalCamera]);

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ printerId?: number; source?: CameraSource }>).detail;
      if (detail?.printerId !== printerId || !isCameraSource(detail.source)) return;
      setSelectedSource(hasExternalCamera ? detail.source : 'builtin');
    };
    window.addEventListener(CAMERA_SOURCE_CHANGED, onChange);
    return () => window.removeEventListener(CAMERA_SOURCE_CHANGED, onChange);
  }, [printerId, hasExternalCamera]);

  const selectSource = (next: CameraSource): boolean => {
    const resolved = hasExternalCamera ? next : 'builtin';
    if (resolved === selectedSource) return false;
    storeCameraSource(printerId, resolved);
    setSelectedSource(resolved);
    return true;
  };

  return { selectedSource, selectSource };
}

/**
 * Open (or reuse) the standalone /camera/:id popup.
 *
 * Do not assign location after open(): a named window that is already
 * loading the URL would fetch the SPA twice. Do not pass `noopener`:
 * same-origin popups need opener so the browser copies sessionStorage
 * (auth token + stream token) into the new window.
 */
export function openPrinterCameraWindow(printerId: number, features?: string): Window | null {
  const url = `/camera/${printerId}`;
  const name = `camera-${printerId}`;
  const win = features ? window.open(url, name, features) : window.open(url, name);
  if (!win) return null;
  try {
    win.focus();
  } catch {
    // Ignore: window may already be closing.
  }
  return win;
}

interface CameraSourceSwitcherProps {
  selected: CameraSource;
  onSelect: (source: CameraSource) => void;
  disabled?: boolean;
  size?: 'default' | 'compact';
}

export function CameraSourceSwitcher({
  selected,
  onSelect,
  disabled = false,
  size = 'default',
}: CameraSourceSwitcherProps) {
  const { t } = useTranslation();
  const compact = size === 'compact';
  const pad = compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-3 py-1 text-xs';

  return (
    <div
      className={`flex rounded p-0.5 flex-shrink-0 ${compact ? 'bg-black/70' : 'bg-bambu-dark'}`}
      role="group"
      aria-label={t('camera.selectCamera')}
      data-camera-source-switcher=""
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => onSelect('builtin')}
        disabled={disabled}
        className={`${pad} rounded transition-colors ${
          selected === 'builtin'
            ? 'bg-bambu-green text-white'
            : 'text-bambu-gray hover:text-white disabled:opacity-50'
        }`}
        title={t('camera.selectBuiltIn')}
      >
        {t('camera.builtIn')}
      </button>
      <button
        type="button"
        onClick={() => onSelect('external')}
        disabled={disabled}
        className={`${pad} rounded transition-colors ${
          selected === 'external'
            ? 'bg-bambu-green text-white'
            : 'text-bambu-gray hover:text-white disabled:opacity-50'
        }`}
        title={t('camera.selectExternal')}
      >
        {t('camera.external')}
      </button>
    </div>
  );
}
