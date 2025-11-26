
import React, { useEffect, useState } from 'react';
import { getVehicle, getActiveLog, startTrip, endTrip, getUserActiveTrip } from '../services/db';
import { Vehicle, VehicleLog, User, VehicleStatus } from '../types';

interface DriverViewProps {
  user: User;
  vehicleId: string;
  onLogout: () => void;
}

const TripTimer: React.FC<{ startTime: string }> = ({ startTime }) => {
    const [duration, setDuration] = useState('');

    useEffect(() => {
        const start = new Date(startTime).getTime();
        const interval = setInterval(() => {
            const now = new Date().getTime();
            const diff = now - start;
            
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            
            const fmt = (n: number) => n.toString().padStart(2, '0');
            setDuration(`${fmt(hours)}:${fmt(minutes)}:${fmt(seconds)}`);
        }, 1000);
        
        return () => clearInterval(interval);
    }, [startTime]);

    return <span className="font-mono text-5xl font-extrabold tracking-widest text-white drop-shadow-md">{duration}</span>;
}

export const DriverView: React.FC<DriverViewProps> = ({ user, vehicleId, onLogout }) => {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [vehicleActiveLog, setVehicleActiveLog] = useState<VehicleLog | undefined>(undefined);
  const [userActiveLog, setUserActiveLog] = useState<VehicleLog | undefined>(undefined);
  const [otherVehicleName, setOtherVehicleName] = useState<string>('');
  
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    const v = await getVehicle(vehicleId);
    setVehicle(v || null);

    const vLog = await getActiveLog(vehicleId);
    setVehicleActiveLog(vLog);

    const uLog = await getUserActiveTrip(user.id);
    setUserActiveLog(uLog);

    if (uLog && v && uLog.vehicleId !== v.id) {
        const otherV = await getVehicle(uLog.vehicleId);
        if (otherV) setOtherVehicleName(otherV.name);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [vehicleId, user.id]);

  const handleSuccess = (msg: string) => {
      setSuccessMessage(msg);
      setTimeout(() => {
          window.location.hash = ''; // Clear hash to return to menu/scan
          onLogout(); 
      }, 2000);
  };

  const handleTakeVehicle = async () => {
    if (!vehicle) return;
    setActionLoading(true);
    await startTrip(vehicle.id, user);
    setActionLoading(false);
    handleSuccess('¡Vehículo Asignado!');
  };

  const handleReturnVehicle = async () => {
    if (!vehicle) return;
    setActionLoading(true);
    await endTrip(vehicle.id);
    setActionLoading(false);
    handleSuccess('¡Vehículo Devuelto!');
  };

  const handleBack = () => {
      window.location.hash = '';
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-white text-xl animate-pulse font-medium">Conectando con flota...</div>
    </div>
  );

  if (successMessage) return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-4 text-center">
          <div className="rounded-full bg-green-500 text-white p-6 mb-6 shadow-lg animate-bounce">
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <h2 className="text-3xl font-bold mb-2">{successMessage}</h2>
      </div>
  );

  if (!vehicle) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-100 p-4">
        <div className="text-red-500 font-bold text-xl mb-4">Vehículo no encontrado</div>
        <button onClick={handleBack} className="bg-slate-800 text-white px-6 py-2 rounded-lg font-bold">Volver</button>
    </div>
  );

  const hasDifferentVehicle = userActiveLog && userActiveLog.vehicleId !== vehicle.id;
  if (hasDifferentVehicle) {
      return (
          <div className="min-h-screen bg-red-50 p-6 flex flex-col items-center justify-center text-center">
              <div className="bg-white p-6 rounded-2xl shadow-xl max-w-sm w-full border-l-8 border-red-500">
                  <div className="text-red-500 mb-4 flex justify-center">
                      <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">No puedes tomar este auto</h2>
                  <p className="text-gray-600 mb-6">
                      Ya tienes un viaje en curso con: <br/>
                      <strong className="text-gray-800 block mt-1 text-lg">{otherVehicleName || 'Otro Vehículo'}</strong>
                  </p>
                  <button onClick={() => window.location.hash = ''} className="w-full py-3 bg-slate-800 text-white rounded-xl font-bold shadow hover:bg-black">
                      Entendido
                  </button>
              </div>
          </div>
      );
  }

  const isMyTrip = vehicleActiveLog?.driverId === user.id;
  if (isMyTrip) {
      return (
          <div className="min-h-screen bg-blue-50 flex flex-col relative">
                 <button onClick={fetchData} className="absolute top-4 right-4 text-white/50 hover:text-white z-10 bg-black/20 p-2 rounded-full">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                 </button>

                 {/* Updated to Blue Theme */}
                 <div className="bg-gradient-to-br from-blue-700 to-blue-500 p-8 pb-24 rounded-b-[3rem] shadow-lg text-center">
                    <h1 className="text-3xl font-bold text-white">{vehicle.name}</h1>
                    <p className="text-blue-100 mt-2 text-lg tracking-widest font-mono">{vehicle.licensePlate}</p>
                    <div className="mt-8 flex flex-col items-center gap-2">
                        <span className="text-blue-200 text-xs uppercase tracking-wider font-bold">Tiempo en Viaje</span>
                        <div className="bg-black/20 text-white px-10 py-6 rounded-2xl border border-white/10 shadow-inner backdrop-blur-sm">
                            {vehicleActiveLog && <TripTimer startTime={vehicleActiveLog.startTime} />}
                        </div>
                    </div>
                 </div>

                 <div className="flex-1 flex flex-col items-center justify-center p-6 -mt-10">
                     <div className="bg-white w-full max-w-sm p-6 rounded-2xl shadow-xl text-center space-y-6">
                        <p className="text-slate-600 text-lg font-medium">¿Vas a dejar el vehículo?</p>
                        
                        {/* FOTO DEL VEHICULO AL DEVOLVER */}
                        <div className="w-full h-48 rounded-xl overflow-hidden bg-gray-100 border border-slate-200 relative flex items-center justify-center">
                            {vehicle.imageUrl ? (
                                <img src={vehicle.imageUrl} alt={vehicle.name} className="w-full h-full object-contain" />
                            ) : (
                                <div className="text-slate-400 flex flex-col items-center">
                                    <svg className="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                    <span className="text-xs">Sin imagen disponible</span>
                                </div>
                            )}
                        </div>

                        <button
                            onClick={handleReturnVehicle}
                            disabled={actionLoading}
                            className="w-full py-5 bg-slate-900 text-white text-xl font-bold rounded-xl shadow-lg hover:bg-black transform transition hover:scale-105 active:scale-95 border-b-4 border-slate-700 active:border-b-0 active:translate-y-1"
                        >
                            {actionLoading ? 'Procesando...' : 'DEVOLVER VEHÍCULO'}
                        </button>
                     </div>
                     <button onClick={handleBack} className="mt-6 text-slate-400 text-sm underline hover:text-slate-600">Cancelar</button>
                 </div>
          </div>
      );
  }

  const isMaintenance = vehicle.status === VehicleStatus.MAINTENANCE;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col relative">
        {/* Header changes color based on Maintenance Status */}
        <div className={`${isMaintenance ? 'bg-red-600' : 'bg-green-600'} p-8 pb-16 rounded-b-[3rem] shadow-lg text-center relative transition-colors duration-500`}>
             <button onClick={fetchData} className="absolute top-4 right-4 text-white/50 hover:text-white z-10 bg-black/20 p-2 rounded-full">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
             </button>

            <h1 className="text-3xl font-bold text-white">{vehicle.name}</h1>
            <p className={`${isMaintenance ? 'text-red-100' : 'text-green-100'} mt-2 text-lg tracking-widest font-mono`}>{vehicle.licensePlate}</p>
            
            {/* STATUS LABELS */}
            {isMaintenance && (
                <div className="mt-4 inline-flex items-center gap-2 bg-white text-red-600 px-4 py-1.5 rounded-full font-bold text-sm shadow-md animate-pulse">
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                   MANTENIMIENTO
                </div>
            )}
            
            {vehicle.status === VehicleStatus.IN_USE && (
                <div className="mt-4 inline-block bg-white/20 backdrop-blur-sm border border-white/30 text-white px-4 py-1 rounded-full font-bold text-sm shadow-sm">
                    EN USO (Cambio de chofer)
                </div>
            )}
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-6 -mt-10">
            <div className="bg-white w-full max-w-sm p-6 rounded-2xl shadow-xl text-center space-y-6">
                
                {/* FOTO DEL VEHICULO */}
                <div className="w-full h-48 rounded-xl overflow-hidden bg-gray-100 border border-slate-200 relative flex items-center justify-center">
                    {vehicle.imageUrl ? (
                        <img src={vehicle.imageUrl} alt={vehicle.name} className={`w-full h-full object-contain ${isMaintenance ? 'grayscale opacity-75' : ''}`} />
                    ) : (
                        <div className="text-slate-400 flex flex-col items-center">
                            <svg className="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            <span className="text-xs">Sin imagen disponible</span>
                        </div>
                    )}
                </div>

                {isMaintenance ? (
                    <div className="space-y-4">
                        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-left">
                            <h3 className="text-red-800 font-bold text-lg mb-1 flex items-center gap-2">
                                ⛔ Vehículo Bloqueado
                            </h3>
                            <p className="text-red-600 text-sm leading-relaxed mb-3">
                                Este vehículo se encuentra en reparación o servicio técnico y no puede ser utilizado.
                            </p>
                            
                            {vehicle.notes ? (
                                <div className="bg-white rounded-lg p-3 border border-red-100 shadow-sm">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Detalle del Supervisor:</span>
                                    <p className="text-slate-800 text-sm font-medium">{vehicle.notes}</p>
                                </div>
                            ) : (
                                <p className="text-xs text-red-400 italic">Sin detalles adicionales registrados.</p>
                            )}
                        </div>
                        <button
                            onClick={handleBack}
                            className="w-full py-4 bg-slate-800 text-white text-lg font-bold rounded-xl shadow hover:bg-black transition-colors"
                        >
                            Volver al Inicio
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="text-slate-500 text-sm font-medium">
                            Al tomar el vehículo, confirmas que tienes las llaves y estás listo para salir.
                        </div>

                        <button
                            onClick={handleTakeVehicle}
                            disabled={actionLoading}
                            className="w-full py-5 bg-green-600 text-white text-xl font-bold rounded-xl shadow-lg hover:bg-green-700 transform transition hover:scale-105 active:scale-95 flex items-center justify-center gap-2 border-b-4 border-green-800 active:border-b-0 active:translate-y-1"
                        >
                            {actionLoading ? 'Asignando...' : <span>TOMAR VEHÍCULO</span>}
                        </button>
                    </>
                )}
            </div>
            {!isMaintenance && (
                <button onClick={handleBack} className="mt-8 text-slate-400 text-sm hover:text-slate-600 font-medium">Cancelar</button>
            )}
        </div>
    </div>
  );
};
