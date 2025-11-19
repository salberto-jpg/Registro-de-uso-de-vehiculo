
import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface QrScannerProps {
  onScan: (decodedText: string) => void;
}

export const QrScanner: React.FC<QrScannerProps> = ({ onScan }) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string>('');
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    // Use a unique ID for the reader element to avoid conflicts
    const elementId = "reader-camera";
    
    const startScanner = async () => {
        try {
            // Initialize the scanner
            const html5QrCode = new Html5Qrcode(elementId);
            scannerRef.current = html5QrCode;

            const config = {
                fps: 10, // Higher FPS for faster scanning
                qrbox: { width: 250, height: 250 }, // Scan area size
                aspectRatio: 1.0,
                formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ] // Only QR
            };

            await html5QrCode.start(
                { facingMode: "environment" }, // Back camera
                config,
                (decodedText) => {
                    // Success callback
                    console.log("QR Scanned:", decodedText);
                    if (scannerRef.current?.isScanning) {
                         scannerRef.current.stop().then(() => {
                             setScanning(false);
                             onScan(decodedText);
                         }).catch(err => console.error("Stop failed", err));
                    }
                },
                (errorMessage) => {
                    // Parse error, ignore logging to keep console clean
                }
            );
        } catch (err) {
            console.error("Error starting scanner:", err);
            setError("No se pudo acceder a la cámara. Por favor, verifica los permisos.");
            setScanning(false);
        }
    };

    if (scanning) {
        startScanner();
    }

    // Cleanup function
    return () => {
        if (scannerRef.current) {
            if (scannerRef.current.isScanning) {
                scannerRef.current.stop()
                    .then(() => {
                        scannerRef.current?.clear();
                    })
                    .catch(err => console.warn("Scanner stop error during cleanup", err));
            } else {
                 try {
                     scannerRef.current.clear();
                 } catch (e) {
                     // Ignore clear errors if not scanning
                 }
            }
        }
    };
  }, []); // Empty dependency array ensures this runs once on mount

  return (
    <div className="w-full max-w-sm mx-auto overflow-hidden rounded-2xl bg-black shadow-2xl border border-gray-800 relative">
        {/* Container for the video stream */}
        <div id="reader-camera" className="w-full h-[350px] bg-black"></div>
        
        {/* Overlay Guidelines */}
        {scanning && !error && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-64 h-64 border-2 border-indigo-500/50 rounded-lg relative">
                    <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-indigo-400"></div>
                    <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-indigo-400"></div>
                    <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-indigo-400"></div>
                    <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-indigo-400"></div>
                </div>
                <p className="absolute bottom-4 text-white/70 text-xs bg-black/50 px-3 py-1 rounded-full backdrop-blur-sm">
                    Apunta al código QR
                </p>
            </div>
        )}

        {/* Error Message */}
        {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white bg-gray-900 p-6 text-center z-10">
                <svg className="w-12 h-12 text-red-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                <p className="font-bold text-lg mb-2">Error de Cámara</p>
                <p className="text-sm text-gray-400">{error}</p>
                <button onClick={() => window.location.reload()} className="mt-6 bg-indigo-600 px-4 py-2 rounded text-sm">Reintentar</button>
            </div>
        )}
    </div>
  );
};
