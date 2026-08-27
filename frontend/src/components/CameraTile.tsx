import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, VideoOff, WifiOff } from 'lucide-react';
import { withStreamToken } from '../api/client';
import { formatDuration } from '../utils/date';
import { CameraSourceSwitcher, type CameraSource } from './CameraSourceSwitcher';

export type CameraTileMode = 'live' | 'snapshot' | 'paused';
export type CameraTileStatusMode = 'off' | 'compact' | 'full';

interface CameraTileProps {
  printerId: number;
  printerName: string;
  cameraRotation?: number;
  mode: CameraTileMode;
  snapshotIntervalMs: number;
  connected: boolean;
  onClick?: () => void;
  // When true, the tile shows Built-in / External between the status chip
  // and the Live badge. The stream URL then carries ?source= so this pane
  // can pick independently of other viewers.
  hasExternalCamera?: boolean;
  // Optional status overlay — wired by CameraWall from the shared
  // ['printerStatus', id] query. All optional so existing tests don't break.
  statusMode?: CameraTileStatusMode;
  printerState?: string | null;
  progress?: number | null;
  remainingMin?: number | null;
  layerNum?: number | null;
  totalLayers?: number | null;
  printName?: string | null;
  hmsErrorCount?: number;
}

// Tiles render lighter than EmbeddedCameraViewer's full window: lower fps,
// no drag/resize/zoom shell, and snapshot fallback when off-cap. The server
// still does the MJPEG fan-out, so per-tile cost is one TLS pull on the wire.
const LIVE_FPS = 8;

type StatusBucket = 'printing' | 'paused' | 'finished' | 'error' | 'idle';

function classifyState(state: string | null | undefined, hmsErrorCount: number): StatusBucket {
  if (hmsErrorCount > 0) return 'error';
  switch (state) {
    case 'RUNNING':
      return 'printing';
    case 'PAUSE':
      return 'paused';
    case 'FINISH':
    case 'FAILED':
      return 'finished';
    default:
      return 'idle';
  }
}

const BUCKET_CHIP_CLASS: Record<StatusBucket, string> = {
  printing: 'bg-bambu-green/85 text-black',
  paused: 'bg-amber-500/85 text-black',
  finished: 'bg-sky-500/80 text-white',
  error: 'bg-red-500/85 text-white',
  idle: 'bg-bambu-dark-tertiary/80 text-bambu-gray',
};

export function CameraTile({
  printerId,
  printerName,
  cameraRotation = 0,
  mode,
  snapshotIntervalMs,
  connected,
  onClick,
  hasExternalCamera = false,
  statusMode = 'off',
  printerState = null,
  progress = null,
  remainingMin = null,
  layerNum = null,
  totalLayers = null,
  printName = null,
  hmsErrorCount = 0,
}: CameraTileProps) {
  const { t } = useTranslation();
  const [bust, setBust] = useState(0);
  const [errored, setErrored] = useState(false);
  const [shownSrc, setShownSrc] = useState('');
  const [sourceOverride, setSourceOverride] = useState<CameraSource | null>(null);
  const selectedSource: CameraSource = sourceOverride ?? (hasExternalCamera ? 'external' : 'builtin');

  // Closing the <img> (mode change or unmount) aborts the HTTP body; the
  // backend drops this viewer's fan-out subscription. No /camera/stop.
  useEffect(() => {
    setErrored(false);
    setBust((b) => b + 1);
  }, [mode, printerId]);

  useEffect(() => {
    if (mode !== 'snapshot') return;
    const interval = setInterval(() => setBust((b) => b + 1), snapshotIntervalMs);
    return () => clearInterval(interval);
  }, [mode, snapshotIntervalMs]);

  const sourceQuery = sourceOverride ? `&source=${encodeURIComponent(sourceOverride)}` : '';
  const liveUrl = withStreamToken(
    `/api/v1/printers/${printerId}/camera/stream?fps=${LIVE_FPS}&t=${bust}${sourceQuery}`,
  );
  const snapshotUrl = withStreamToken(
    `/api/v1/printers/${printerId}/camera/snapshot?t=${bust}${sourceQuery}`,
  );
  const nextSrc = mode === 'live' ? liveUrl : snapshotUrl;
  const holdingPrevious = Boolean(shownSrc && nextSrc && shownSrc !== nextSrc);

  // A kiosk wall passes no onClick — there is no pointer at a TV, and the page
  // is authenticated by a token that cannot open the single-camera view. Render
  // the tile as plain, non-focusable content rather than a button that looks
  // clickable and then does nothing.
  const interactive = onClick != null;

  const transform = cameraRotation ? `rotate(${cameraRotation}deg)` : undefined;

  const bucket = classifyState(printerState, hmsErrorCount);
  // Hide chip for idle to keep cold walls clean; always show when something
  // is happening (printing/paused/finished/error).
  const showChip = connected && statusMode !== 'off' && bucket !== 'idle';
  const isPrintingOrPaused = bucket === 'printing' || bucket === 'paused';
  const showInfoStrip = connected && statusMode === 'full' && isPrintingOrPaused;
  const fileLabel = printName ?? null;
  const progressPct = progress != null ? Math.round(progress) : null;
  const hasLayers = layerNum != null && totalLayers != null && totalLayers > 0;
  const hasRemaining = remainingMin != null && remainingMin > 0;

  const rootClass = `group relative aspect-video w-full overflow-hidden rounded-lg border border-bambu-dark-tertiary bg-black text-left ${
    interactive ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-bambu-green' : 'cursor-default'
  }`;

  const switchCameraSource = (next: CameraSource) => {
    if (next === selectedSource) return;
    setSourceOverride(next);
    setErrored(false);
    setBust((b) => b + 1);
  };

  const content = (
    <>
      {!connected || mode === 'paused' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-bambu-dark/60">
          {connected ? (
            <VideoOff className="h-8 w-8 text-bambu-gray/70" aria-hidden="true" />
          ) : (
            <WifiOff className="h-8 w-8 text-bambu-gray/70" aria-hidden="true" />
          )}
        </div>
      ) : errored ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/80 text-bambu-gray">
          <VideoOff className="h-7 w-7" aria-hidden="true" />
          <span className="text-xs">{t('printers.camWall.noSignal')}</span>
        </div>
      ) : (
        <>
          {holdingPrevious && (
            <img
              src={shownSrc}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="h-full w-full select-none object-contain"
              style={{ transform }}
            />
          )}
          <img
            src={nextSrc}
            alt={printerName}
            draggable={false}
            className={`h-full w-full select-none object-contain ${holdingPrevious ? 'absolute inset-0 opacity-0' : ''}`}
            style={{ transform }}
            onError={() => {
              if (shownSrc && shownSrc !== nextSrc) return;
              setErrored(true);
            }}
            onLoad={() => setShownSrc(nextSrc)}
          />
        </>
      )}

      {/* Top overlay: status | Built-in/External | Live. Grid keeps the
          source switcher between the two badges even when the chip is hidden. */}
      <div className="pointer-events-none absolute inset-x-2 top-2 z-20 grid grid-cols-3 items-center gap-1">
        <div className="justify-self-start">
          {showChip && (
            <span
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${BUCKET_CHIP_CLASS[bucket]}`}
            >
              {hmsErrorCount > 0 && (
                <AlertTriangle
                  className="h-3 w-3"
                  aria-hidden="true"
                />
              )}
              <span>{t(`printers.status.${bucket}`)}</span>
            </span>
          )}
        </div>
        <div className="pointer-events-auto justify-self-center">
          {hasExternalCamera && (
            <CameraSourceSwitcher
              size="compact"
              selected={selectedSource}
              onSelect={switchCameraSource}
            />
          )}
        </div>
        <div className="justify-self-end">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              mode === 'live'
                ? 'bg-red-500/80 text-white'
                : mode === 'snapshot'
                  ? 'bg-amber-500/70 text-black'
                  : 'bg-bambu-dark-tertiary/70 text-bambu-gray'
            }`}
          >
            {mode === 'live'
              ? t('printers.camWall.live')
              : mode === 'snapshot'
                ? t('printers.camWall.snap')
                : t('printers.camWall.off')}
          </span>
        </div>
      </div>

      {/* Bottom overlay: name + (when full) print info */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-2 pb-1.5 pt-3 text-white">
        {showInfoStrip && (
          <div className="mb-0.5 space-y-0.5 text-[11px] leading-tight text-white/90">
            {fileLabel && (
              <div className="truncate" title={fileLabel}>
                {fileLabel}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-bambu-gray">
              {progressPct != null && (
                <span className="font-semibold text-white">{progressPct}%</span>
              )}
              {hasLayers && (
                <span>
                  {t('printers.camWall.layer', {
                    cur: layerNum,
                    total: totalLayers,
                  })}
                </span>
              )}
              {hasRemaining && (
                <span>
                  {t('printers.camWall.timeLeft', {
                    time: formatDuration((remainingMin ?? 0) * 60),
                  })}
                </span>
              )}
            </div>
          </div>
        )}
        <span className="block truncate text-xs font-medium">{printerName}</span>
      </div>
    </>
  );

  const handleActivate = (e: { target: EventTarget | null; preventDefault?: () => void }) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-camera-source-switcher]')) return;
    e.preventDefault?.();
    onClick?.();
  };

  if (!interactive) {
    return (
      <div className={rootClass} title={printerName}>
        {content}
      </div>
    );
  }

  // A <div role="button"> rather than <button>: the source switcher has its
  // own buttons, and those cannot nest inside another button.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        handleActivate(e);
      }}
      className={rootClass}
      title={printerName}
    >
      {content}
    </div>
  );
}
