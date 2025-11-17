import React from 'react';

interface QRCodeProps {
  vehicleId: string;
  vehicleName: string;
  size?: number;
}

export const QRCodeDisplay: React.FC<QRCodeProps> = ({ vehicleId, vehicleName, size = 150 }) => {
  // Use window.location.href to build the target URL
  // This ensures it works relative to wherever the app is hosted
  const baseUrl = window.location.href.split('#')[0];
  const targetUrl = `${baseUrl}#/vehicle/${vehicleId}`;
  
  // QR Code API
  const qrSize = Math.max(100, Math.min(500, size));
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize}x${qrSize}&data=${encodeURIComponent(targetUrl)}`;

  return (
    <div className="flex flex-col items-center p-6 bg-white rounded-xl border border-gray-200 shadow-sm max-w-sm mx-auto print:shadow-none print:border-0 print:p-0">
      {/* Visual header for the card */}
      <div className="text-center mb-4">
          <h3 className="text-2xl font-extrabold text-gray-900 uppercase tracking-wider">{vehicleName}</h3>
          <p className="text-gray-500 text-sm font-medium mt-1 print:text-black">Escanea para registrar uso</p>
      </div>

      {/* QR Code Image container */}
      <div className="bg-white p-2 border-4 border-gray-900 rounded-lg mb-4 print:border-black">
        <img 
          src={qrUrl} 
          alt={`QR Code for ${vehicleName}`} 
          width={size} 
          height={size} 
          className="block"
        />
      </div>

      {/* ID Badge */}
      <div className="bg-gray-100 px-6 py-2 rounded-full border border-gray-200 print:bg-transparent print:border-black print:border">
         <p className="font-mono font-bold text-gray-700 text-xl tracking-widest print:text-black">{vehicleId}</p>
      </div>
      
      <div className="mt-4 text-center print:hidden">
          <p className="text-xs text-gray-400">ID del Sistema: {vehicleId}</p>
      </div>
    </div>
  );
};