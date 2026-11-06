import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, VideoOff, WifiOff } from 'lucide-react';
import { getAuthToken, withStreamToken } from '../api/client';
import { formatDuration } from '../utils/date';
import { useStreamImgRef } from '../hooks/useStreamImgRef';
import { useCameraViewerId } from '../hooks/useCameraViewerId';
import { isSideways, useSidewaysBox } from '../hooks/useSidewaysBox';
import { CameraSourceSwitcher, usePersistedCameraSource, type CameraSource } from './CameraSourceSwitcher';

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
  // and the Live badge. The stream URL then carries source= so this pane
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
const LIVE_RENEWAL_MS = 60_000;
// Between closing the old stream and opening the new one: a USB camera serves
// one reader, and the old ffmpeg must let go of the device first.
const RENEWAL_GAP_MS = 200;
// A renewal that failed is tried once more after this.
const RENEWAL_RETRY_MS = 5_000;
// A renewal with no frame by then has failed too: a snapshot camera that is
// down keeps its stream open without one, and the img fires no event at all.
const RENEWAL_FIRST_FRAME_MS = 15_000;

function cameraSourceOf(url: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, 'http://localhost').searchParams.get('source');
  } catch {
    return null;
  }
}

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
  // Last URL that actually painted. While a new source is still starting, a
  // second img keeps that URL so the tile does not go blank. Renewal does not
  // use this: the same camera must close before it opens again.
  const [shownSrc, setShownSrc] = useState('');
  const { selectedSource, selectSource } = usePersistedCameraSource(printerId, hasExternalCamera);
  // The old stream is closed and the new one not yet due: the img renders with
  // no src (removing it closes the connection), so no re-render reopens it early.
  const [reopening, setReopening] = useState(false);
  const lastModeRef = useRef<CameraTileMode>(mode);
  // Every img this tile drops (leaving live mode, a renewal, unmounting) has
  // its stream closed; the /camera/stop sent on leaving live mode is skipped
  // while a dropped img still holds it.
  const imgRef = useRef<HTMLImageElement | null>(null);
  // The held frame is a second img. It must not take imgRef, or a renewal
  // would close the new source and leave the old one running.
  const heldImgRef = useRef<HTMLImageElement | null>(null);
  // On its stream and its /camera/stop: the stop ends this tile's stream only.
  const viewerId = useCameraViewerId();
  const attachImg = useStreamImgRef(imgRef);
  const attachHeldImg = useStreamImgRef(heldImgRef);
  // 'renewed': the current img is a renewal not yet showing a frame; 'retried':
  // it is the one retry of a renewal that failed.
  const renewalRef = useRef<'none' | 'renewed' | 'retried'>('none');
  // A failed snapshot is retried once at the next refresh: the server answers
  // 503 while a live view of this printer is still starting (it will not take
  // the camera from that viewer). Not more: each failed camera img re-mints the
  // page's stream token.
  const snapshotRetriedRef = useRef(false);
  const renewalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstFrameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tell the backend to release its MJPEG transcoder when this tile stops
  // being live — either by unmounting or by transitioning to snapshot/paused.
  // EmbeddedCameraViewer uses the same /camera/stop with keepalive on unmount.
  useEffect(() => {
    const wasLive = lastModeRef.current === 'live';
    const isLive = mode === 'live';
    lastModeRef.current = mode;
    if (wasLive && !isLive) {
      const headers: Record<string, string> = {};
      const token = getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      fetch(`/api/v1/printers/${printerId}/camera/stop?viewer=${viewerId}`, {
        method: 'POST',
        keepalive: true,
        headers,
      }).catch(() => {});
    }
    setErrored(false);
    snapshotRetriedRef.current = false;
    setBust((b) => b + 1);
    // selectedSource: switching cameras refreshes the picture. Leaving live
    // still POSTs /camera/stop above — closing the img is not enough on this tree.
  }, [mode, printerId, viewerId, selectedSource]);

  useEffect(() => {
    return () => {
      if (lastModeRef.current === 'live') {
        const headers: Record<string, string> = {};
        const token = getAuthToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        fetch(`/api/v1/printers/${printerId}/camera/stop?viewer=${viewerId}`, {
          method: 'POST',
          keepalive: true,
          headers,
        }).catch(() => {});
      }
    };
  }, [printerId, viewerId]);

  useEffect(() => {
    if (mode !== 'snapshot') return;
    const interval = setInterval(() => setBust((b) => b + 1), snapshotIntervalMs);
    return () => clearInterval(interval);
  }, [mode, snapshotIntervalMs]);

  // A stream the server ended (its re-check, the camera dropping) fires no img
  // event: the tile would keep its last frame. Renew it, closing the old
  // connection first (a detached img keeps it open). No /camera/stop: other
  // viewers of the printer share the stream. Not in a hidden page, where the
  // stream token is not refreshed. A tile showing no signal is left alone:
  // each failed camera img makes the app re-mint the stream token and
  // reconnect every camera on the page.
  //
  // Built once: they only use refs and state setters, and call each other.
  const { clearFirstFrameTimer, streamFailed, reopenAfter } = useMemo(() => {
    const clearFirstFrameTimer = () => {
      if (firstFrameTimerRef.current !== null) clearTimeout(firstFrameTimerRef.current);
      firstFrameTimerRef.current = null;
    };

    // The stream failed (an error, or a renewal with no frame in time): a
    // renewal is retried once, anything else shows no signal.
    const streamFailed = () => {
      clearFirstFrameTimer();
      if (renewalRef.current === 'renewed') {
        renewalRef.current = 'retried';
        reopenAfter(RENEWAL_RETRY_MS);
        return;
      }
      renewalRef.current = 'none';
      setErrored(true);
    };

    const reopenAfter = (ms: number) => {
      // Closed now, not at the next render: React may batch this with the reopen.
      imgRef.current?.removeAttribute('src');
      setReopening(true);
      if (renewalTimerRef.current !== null) clearTimeout(renewalTimerRef.current);
      renewalTimerRef.current = setTimeout(() => {
        renewalTimerRef.current = null;
        setReopening(false);
        setBust((b) => b + 1);
        clearFirstFrameTimer();
        // A hidden page does not load a lazy img: that time does not count.
        const deadline = () => {
          if (document.hidden) {
            firstFrameTimerRef.current = setTimeout(deadline, RENEWAL_FIRST_FRAME_MS);
            return;
          }
          streamFailed();
        };
        firstFrameTimerRef.current = setTimeout(deadline, RENEWAL_FIRST_FRAME_MS);
      }, ms);
    };

    return { clearFirstFrameTimer, streamFailed, reopenAfter };
  }, []);

  useEffect(() => {
    renewalRef.current = 'none';
    if (mode !== 'live' || !connected) return;
    const interval = setInterval(() => {
      if (document.hidden || !imgRef.current || renewalTimerRef.current !== null) return;
      renewalRef.current = 'renewed';
      reopenAfter(RENEWAL_GAP_MS);
    }, LIVE_RENEWAL_MS);
    return () => {
      clearInterval(interval);
      if (renewalTimerRef.current !== null) clearTimeout(renewalTimerRef.current);
      renewalTimerRef.current = null;
      clearFirstFrameTimer();
      setReopening(false);
    };
  }, [mode, connected, reopenAfter, clearFirstFrameTimer]);

  // A source change is not a renewal of the camera that was already open.
  // Drop a pending close/reopen so the new source is not held shut.
  const selectedSourceRef = useRef(selectedSource);
  useEffect(() => {
    if (selectedSourceRef.current === selectedSource) return;
    selectedSourceRef.current = selectedSource;
    if (renewalTimerRef.current !== null) clearTimeout(renewalTimerRef.current);
    renewalTimerRef.current = null;
    clearFirstFrameTimer();
    renewalRef.current = 'none';
    setReopening(false);
  }, [selectedSource, clearFirstFrameTimer]);

  const sourceQuery = hasExternalCamera ? `&source=${encodeURIComponent(selectedSource)}` : '';
  const liveUrl = withStreamToken(
    `/api/v1/printers/${printerId}/camera/stream?fps=${LIVE_FPS}&t=${bust}&viewer=${viewerId}${sourceQuery}`,
  );
  const snapshotUrl = withStreamToken(
    `/api/v1/printers/${printerId}/camera/snapshot?t=${bust}${sourceQuery}`,
  );
  const nextSrc = reopening || !connected || mode === 'paused' ? '' : mode === 'live' ? liveUrl : snapshotUrl;
  // Same source (renewal, snapshot tick) must not keep the previous URL open.
  const holdingPrevious =
    shownSrc !== '' && nextSrc !== '' && cameraSourceOf(shownSrc) !== cameraSourceOf(nextSrc);

  // A kiosk wall passes no onClick — there is no pointer at a TV, and the page
  // is authenticated by a token that cannot open the single-camera view. Render
  // the tile as plain, non-focusable content rather than a button that looks
  // clickable and then does nothing.
  const interactive = onClick != null;

  // A sideways camera is laid out at the tile's sides swapped and centred, or
  // the rotated picture is cut off at the tile's top and bottom (#3362).
  // One ref for either root: the tile is a button when it can be clicked.
  const tileRef = useRef<HTMLDivElement & HTMLButtonElement>(null);
  const sideways = isSideways(cameraRotation);
  const tile = useSidewaysBox(tileRef, sideways);
  const imgStyle: CSSProperties | undefined =
    sideways && tile
      ? {
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: tile.height,
          height: tile.width,
          maxWidth: 'none',
          transform: `translate(-50%, -50%) rotate(${cameraRotation}deg)`,
        }
      : cameraRotation
        ? { transform: `rotate(${cameraRotation}deg)` }
        : undefined;

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

  const selectTileSource = (next: CameraSource) => {
    const current = imgRef.current?.getAttribute('src');
    if (!selectSource(next)) return;
    if (current) setShownSrc(current);
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
              ref={attachHeldImg}
              src={shownSrc}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="h-full w-full select-none object-contain"
              style={imgStyle}
            />
          )}
          <img
            ref={attachImg}
            key={`${mode}-${bust}`}
            src={reopening ? undefined : mode === 'live' ? liveUrl : snapshotUrl}
            alt={printerName}
            draggable={false}
            loading="lazy"
            className={`h-full w-full select-none object-contain${holdingPrevious ? ' absolute inset-0 opacity-0' : ''}`}
            style={imgStyle}
            onLoad={() => {
              clearFirstFrameTimer();
              renewalRef.current = 'none';
              snapshotRetriedRef.current = false;
              setShownSrc(mode === 'live' ? liveUrl : snapshotUrl);
            }}
            onError={(e) => {
              // An img with an empty or missing src is closed, not failed.
              if (!e.currentTarget.getAttribute('src')) return;
              if (mode === 'snapshot' && !snapshotRetriedRef.current) {
                snapshotRetriedRef.current = true;
                return;
              }
              streamFailed();
            }}
          />
        </>
      )}

      {/* Top overlay: status | Built-in/External | Live. The middle column
          keeps the switcher between the badges when the chip is hidden. */}
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
              onSelect={selectTileSource}
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

  if (!interactive) {
    return (
      <div ref={tileRef} className={rootClass} title={printerName}>
        {content}
      </div>
    );
  }

  // The source switcher has its own buttons. Those cannot nest inside the
  // tile's button, so a tile that can switch cameras is a role="button" div.
  if (hasExternalCamera) {
    const handleActivate = (e: { target: EventTarget | null; preventDefault?: () => void }) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-camera-source-switcher]')) return;
      e.preventDefault?.();
      onClick?.();
    };
    return (
      <div
        ref={tileRef}
        role="button"
        tabIndex={0}
        aria-label={printerName}
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

  return (
    <button ref={tileRef} type="button" onClick={onClick} className={rootClass} title={printerName}>
      {content}
    </button>
  );
}
