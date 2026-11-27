import jsQR from 'jsqr';

export type CameraFacing = 'environment' | 'user';
export type QrDecoderBackend = 'native-barcode-detector' | 'jsqr-canvas';

export interface FastQrStartOptions {
  videoEl: HTMLVideoElement;
  facingMode: CameraFacing;
  onDetect: (rawCode: string) => void;
  onInterrupted?: (reason: string) => void;
}

interface NativeBarcodeDetector {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
}

interface NativeBarcodeDetectorCtor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

/**
 * Ultra-lightweight continuous QR camera & decoder engine:
 * - Initializes the camera stream ONCE per facing mode with 720p preference
 * - Uses hardware-accelerated BarcodeDetector when supported (zero canvas copy)
 * - Falls back seamlessly to a single reused offscreen canvas + jsQR
 * - Scans continuously at ~22 fps with zero artificial delays or DOM churn
 */
export class FastQrCameraEngine {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private running = false;
  private decodeBusy = false;
  private lastFrameTs = 0;
  private frameCounter = 0;

  // Reused decoder instances (never re-allocated per frame)
  private nativeDetector: NativeBarcodeDetector | null = null;
  private nativeChecked = false;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private activeBackend: QrDecoderBackend = 'jsqr-canvas';
  private onDetectCb: ((rawCode: string) => void) | null = null;
  private onInterruptedCb: ((reason: string) => void) | null = null;
  private activeTrack: MediaStreamTrack | null = null;
  private handleTrackEndedBound: (() => void) | null = null;

  public get backend(): QrDecoderBackend {
    return this.activeBackend;
  }

  public get isRunning(): boolean {
    return this.running;
  }

  private async ensureDetector(): Promise<void> {
    if (this.nativeChecked) return;
    this.nativeChecked = true;

    try {
      const ctor = (window as unknown as { BarcodeDetector?: NativeBarcodeDetectorCtor })
        .BarcodeDetector;
      if (ctor) {
        if (typeof ctor.getSupportedFormats === 'function') {
          const formats = await ctor.getSupportedFormats();
          if (formats.includes('qr_code')) {
            this.nativeDetector = new ctor({ formats: ['qr_code'] });
            this.activeBackend = 'native-barcode-detector';
            return;
          }
        } else {
          this.nativeDetector = new ctor({ formats: ['qr_code'] });
          this.activeBackend = 'native-barcode-detector';
          return;
        }
      }
    } catch {
      this.nativeDetector = null;
    }

    // Prepare single reused offscreen canvas for jsQR fallback
    this.activeBackend = 'jsqr-canvas';
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
  }

  private async acquireStream(facingMode: CameraFacing): Promise<MediaStream> {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error(
        'Camera API is unavailable in this browser context. Ensure HTTPS is active or use Quick ID Input below.'
      );
    }

    // Tiered constraints: prefer exact 720p rear camera for fastest QR focus & low-latency decode
    const attempts: MediaStreamConstraints[] = [
      {
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { ideal: 30, min: 15 },
        },
      },
      {
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 960 },
          height: { ideal: 540 },
        },
      },
      {
        audio: false,
        video: { facingMode },
      },
      {
        audio: false,
        video: true,
      },
    ];

    let lastErr: unknown = null;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
        // Stop retrying if user explicitly denied camera permission
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          throw err;
        }
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error('Unable to access camera.');
  }

  public async start(options: FastQrStartOptions): Promise<QrDecoderBackend> {
    this.stop();

    this.videoEl = options.videoEl;
    this.onDetectCb = options.onDetect;
    this.onInterruptedCb = options.onInterrupted || null;

    await this.ensureDetector();

    const stream = await this.acquireStream(options.facingMode);
    this.stream = stream;

    const videoTrack = stream.getVideoTracks()[0] || null;
    this.activeTrack = videoTrack;

    // Request continuous autofocus on Android/mobile devices where supported (non-fatal)
    if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
      try {
        const caps =
          typeof videoTrack.getCapabilities === 'function'
            ? (videoTrack.getCapabilities() as Record<string, unknown>)
            : null;
        if (caps && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
          await videoTrack.applyConstraints({
            advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
          });
        }
      } catch {
        // Optional camera capability
      }
    }

    // Listen for unexpected camera stream interruption (e.g., phone call / OS camera reclaim)
    if (videoTrack) {
      this.handleTrackEndedBound = () => {
        if (this.running) {
          this.running = false;
          if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
          }
          this.onInterruptedCb?.('Camera stream was interrupted by the device. Tap Restart Camera to resume.');
        }
      };
      videoTrack.addEventListener('ended', this.handleTrackEndedBound);
    }

    const video = this.videoEl;
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('muted', 'true');
    video.muted = true;

    await video.play();

    this.running = true;
    this.lastFrameTs = 0;
    this.frameCounter = 0;
    this.scheduleNextFrame();

    return this.activeBackend;
  }

  private scheduleNextFrame = () => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);
  };

  private tick = (now: number) => {
    if (!this.running) return;

    // Target ~22 scans/sec (~44ms interval) — snappy detection without CPU overheat
    if (!this.decodeBusy && now - this.lastFrameTs >= 44) {
      this.lastFrameTs = now;
      void this.decodeCurrentFrame();
    }

    this.scheduleNextFrame();
  };

  private async decodeCurrentFrame(): Promise<void> {
    const video = this.videoEl;
    if (!video || !this.running || video.readyState < 2 || video.videoWidth === 0) {
      return;
    }

    this.decodeBusy = true;
    try {
      if (this.nativeDetector) {
        const barcodes = await this.nativeDetector.detect(video);
        if (barcodes.length > 0 && barcodes[0]?.rawValue) {
          this.onDetectCb?.(barcodes[0].rawValue);
        }
        return;
      }

      // Fast jsQR path using reused offscreen canvas
      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      }
      const canvas = this.canvas;
      const ctx = this.ctx;
      if (!ctx) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      this.frameCounter++;

      // Alternate between a crisp center crop (3/4 frames: huge speedup & higher QR resolution)
      // and a scaled full-frame pass (every 4th frame) so off-center cards still detect immediately.
      const useFullFrame = this.frameCounter % 4 === 0;
      let sx = 0;
      let sy = 0;
      let sw = vw;
      let sh = vh;
      let outW = 480;
      let outH = Math.max(1, Math.round((vh / vw) * 480));

      if (!useFullFrame) {
        const cropSize = Math.round(Math.min(vw, vh) * 0.72);
        sx = Math.round((vw - cropSize) / 2);
        sy = Math.round((vh - cropSize) / 2);
        sw = cropSize;
        sh = cropSize;
        outW = Math.min(420, cropSize);
        outH = outW;
      } else if (vw <= 480) {
        outW = vw;
        outH = vh;
      }

      if (canvas.width !== outW || canvas.height !== outH) {
        canvas.width = outW;
        canvas.height = outH;
      }

      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
      const imageData = ctx.getImageData(0, 0, outW, outH);

      // Standard dark-on-light QR codes decode fastest with dontInvert
      const decoded = jsQR(imageData.data, outW, outH, {
        inversionAttempts: 'dontInvert',
      });
      if (decoded?.data) {
        this.onDetectCb?.(decoded.data);
      }
    } catch {
      // If hardware BarcodeDetector fails unexpectedly on a device, degrade gracefully to jsQR
      if (this.nativeDetector) {
        this.nativeDetector = null;
        this.activeBackend = 'jsqr-canvas';
      }
    } finally {
      this.decodeBusy = false;
    }
  }

  public stop(): void {
    this.running = false;
    this.decodeBusy = false;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.activeTrack && this.handleTrackEndedBound) {
      this.activeTrack.removeEventListener('ended', this.handleTrackEndedBound);
    }
    this.activeTrack = null;
    this.handleTrackEndedBound = null;

    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      });
      this.stream = null;
    }

    if (this.videoEl) {
      try {
        this.videoEl.pause();
        this.videoEl.srcObject = null;
      } catch {
        // Ignore cleanup errors
      }
      this.videoEl = null;
    }
  }
}
