'use client';

import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Camera, X } from 'lucide-react';
import { useApp } from '@/lib/app-context';

interface Props {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}

export function CameraBarcodeScanner({ open, onClose, onDetected }: Props) {
  const { L } = useApp();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [err, setErr] = useState<string>('');
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setErr('');

    const start = async () => {
      try {
        const reader = new BrowserMultiFormatReader();
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        // Prefer back camera on Android/mobile
        const back =
          devices.find((d) => /back|rear|environment/i.test(d.label)) ||
          devices[devices.length - 1];

        if (!videoRef.current) return;
        const controls = await reader.decodeFromVideoDevice(
          back?.deviceId,
          videoRef.current,
          (result) => {
            if (result && !cancelled) {
              const code = result.getText().trim();
              if (code) {
                cancelled = true;
                controls.stop();
                onDetected(code);
                onClose();
              }
            }
          },
        );
        controlsRef.current = controls;
      } catch (e) {
        if (!cancelled) {
          setErr(
            e instanceof Error
              ? e.message
              : L('कैमरा शुरू नहीं हो सका। अनुमति जांचें।', 'Unable to start camera. Check permissions.'),
          );
        }
      }
    };

    start();
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, onClose, onDetected, L]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 font-bold text-stone-800">
            <Camera className="h-5 w-5 text-khadi-600" />
            <span>{L('कैमरा बारकोड स्कैनर', 'Camera Barcode Scanner')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative bg-black">
          <video ref={videoRef} className="aspect-[4/3] w-full object-cover" playsInline muted />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-32 w-64 rounded-lg border-2 border-amber-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        </div>

        <div className="p-4 text-center text-sm text-stone-600">
          {err ? (
            <p className="font-medium text-red-600">{err}</p>
          ) : (
            <p>{L('बारकोड को पीले बॉक्स के अंदर रखें', 'Align the barcode inside the yellow frame')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
