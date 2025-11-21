import React, { useState, useEffect } from 'react';
import { Login } from './pages/Login';
import { AdminDashboard } from './pages/AdminDashboard';
import { DriverView } from './pages/DriverView';
import { User, UserRole } from './types';
import { subscribeToAuthChanges, getCurrentUserProfile, updateUserPassword, signOut } from './services/db';
import { QrScanner } from './components/QrScanner';

const UpdatePasswordView: React.FC<{ onUpdated: () => void }> = ({ onUpdated }) => {
    const [pass, setPass] = useState('');
    const [loading, setLoading] = useState(false);
    const bgImage = "https://wqccvxkbmoqgiiplogew.supabase.co/storage/v1/object/public/imagenes/fondo.png";

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const { error } = await updateUserPassword(pass);
            if (error) throw error;
            alert("Contraseña actualizada correctamente.");
            onUpdated();
        } catch (err: any) {
            alert(err.message || "Error al actualizar contraseña");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center relative bg-gray-300 font-sans overflow-hidden">
             <img src={bgImage} alt="Fondo" className="absolute inset-0 w-full h-full object-contain object-bottom z-0 opacity-50" />
            <div className="relative z-10 max-w-md w-full bg-white/90 backdrop-blur shadow-xl rounded-xl p-8 m-4 border border-white/50">
                <h2 className="text-2xl font-bold mb-2 text-gray-900 text-center">Recuperación de Cuenta</h2>
                <p className="text-sm text-gray-600 text-center mb-6">Por favor, ingresa tu nueva contraseña.</p>
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2">Nueva Contraseña</label>
                        <input type="password" required placeholder="******" className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500" value={pass} onChange={e => setPass(e.target.value)} minLength={6} />
                    </div>
                    <button disabled={loading} className="w-full bg-indigo-600 text-white p-3 rounded font-bold hover:bg-indigo-700 transition transform active:scale-95 shadow-lg">
                        {loading ? 'Guardando...' : 'Actualizar Contraseña'}
                    </button>
                </form>
            </div>
        </div>
    )
}

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true); 
  const [longLoad, setLongLoad] = useState(false);
  const [route, setRoute] = useState<string>(window.location.hash);
  const [manualId, setManualId] = useState('');
  
  const [isRecovery, setIsRecovery] = useState(() => {
      const h = window.location.hash;
      return h && (h.includes('type=recovery') || h.includes('type=invite'));
  });

  useEffect(() => {
    const handleHashChange = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleEmergencyReset = async () => {
      setLoading(true);
      await signOut();
      localStorage.clear(); 
      sessionStorage.clear();
      window.location.reload();
  };

  useEffect(() => {
      let mounted = true;

      // --- TIMER DE AYUDA VISUAL ---
      // Si tarda más de 3 segundos, mostramos botón de "Forzar Entrada"
      const helpTimer = setTimeout(() => {
          if (mounted && loading) {
              setLongLoad(true);
          }
      }, 3000);

      const initAuth = async () => {
          try {
              // Esta función ahora está optimizada para NO fallar si hay sesión
              const profile = await getCurrentUserProfile();
              
              if (mounted) {
                  if (profile) {
                      setUser(profile);
                  } else {
                      setUser(null);
                  }
              }
          } catch (e) {
              console.error("Error crítico en inicialización:", e);
              if (mounted) setUser(null);
          } finally {
              if (mounted) {
                  setLoading(false);
              }
          }
      };

      initAuth();

      const { data: { subscription } } = subscribeToAuthChanges(async (event, session) => {
          if (!mounted) return;

          if (event === 'PASSWORD_RECOVERY') {
              setIsRecovery(true);
          } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
              // Si la sesión cambia, intentamos actualizar, pero sin bloquear si ya tenemos user
              const profile = await getCurrentUserProfile();
              if (mounted && profile) {
                   setUser(profile);
                   setLoading(false); // Asegurar que quite carga
              }
          } else if (event === 'SIGNED_OUT') {
              setUser(null);
              setIsRecovery(false);
              setLoading(false);
          }
      });
      
      return () => {
          mounted = false;
          clearTimeout(helpTimer);
          subscription.unsubscribe();
      };
  }, []);

  const vehicleMatch = route.match(/#\/vehicle\/(.+)/);
  const vehicleId = vehicleMatch ? vehicleMatch[1] : null;

  const handleManualSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (manualId.trim()) {
          window.location.hash = `/vehicle/${manualId.trim()}`;
      }
  };

  const handleScan = (decodedText: string) => {
      try {
          if (decodedText.includes('/vehicle/')) {
              const parts = decodedText.split('/vehicle/');
              if (parts.length > 1) {
                  const id = parts[1];
                  window.location.hash = `/vehicle/${id}`;
              } else {
                  window.location.href = decodedText;
              }
          } else {
              window.location.hash = `/vehicle/${decodedText}`;
          }
      } catch (e) {
          console.error("Error parsing scan result", e);
          alert("Código QR no válido");
      }
  };
  
  const handlePasswordUpdated = async () => {
      setIsRecovery(false);
      const profile = await getCurrentUserProfile();
      if (profile) setUser(profile);
      window.location.hash = '';
  };

  if (loading) {
      return (
          <div className="min-h-screen flex items-center justify-center bg-gray-100 relative">
              <div className="flex flex-col items-center gap-6 p-6 text-center max-w-sm w-full z-10">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
                  
                  <div>
                    <p className="text-gray-800 font-bold text-lg">Cargando Perfil...</p>
                    <p className="text-xs text-gray-500 mt-1">Validando sesión segura</p>
                  </div>
                  
                  {/* Botón de escape manual si tarda mucho */}
                  {longLoad && (
                      <div className="mt-4 animate-fade-in">
                        <p className="text-xs text-red-500 mb-2">¿Está tardando mucho?</p>
                        <div className="flex flex-col gap-2">
                            <button 
                                onClick={() => setLoading(false)}
                                className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded shadow hover:bg-indigo-700 transition-colors"
                            >
                                🚀 FORZAR ENTRADA
                            </button>
                            <button 
                                onClick={handleEmergencyReset}
                                className="px-4 py-2 text-gray-400 text-xs underline hover:text-gray-600"
                            >
                                Cerrar Sesión y Recargar
                            </button>
                        </div>
                      </div>
                  )}
              </div>
          </div>
      );
  }

  if (isRecovery) {
      return <UpdatePasswordView onUpdated={handlePasswordUpdated} />;
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  if (vehicleId) {
    return <DriverView user={user} vehicleId={vehicleId} onLogout={() => { window.location.hash = ''; }} />;
  }

  if (user.role === UserRole.ADMIN || user.role === UserRole.SUPERVISOR) {
    return <AdminDashboard user={user} />;
  }

  if (user.role === UserRole.DRIVER) {
    return (
      <div className="min-h-screen bg-[#0f1115] flex flex-col font-sans">
          
          <header className="px-6 pt-8 pb-2 flex justify-between items-end">
            <div className="flex flex-col">
              <span className="text-indigo-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-1 opacity-80">
                Gestión de Vehículo
              </span>
              <h1 className="text-white text-3xl font-black tracking-tight leading-none">
                Hola, <br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-200 to-white">
                  {user.name.split(' ')[0]}
                </span>
                <span className="ml-2 text-2xl inline-block animate-pulse">👋</span>
              </h1>
            </div>
            
            <button 
                onClick={() => { setUser(null); signOut(); }} 
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-xs font-semibold px-4 py-2 rounded-full transition-all active:scale-95 backdrop-blur-md"
            >
                Salir
            </button>
          </header>

          <main className="flex-1 flex flex-col items-center justify-start p-4 text-center max-w-md mx-auto w-full space-y-6">
              
              <div className="w-full flex-1 flex flex-col justify-center max-h-[400px]">
                  <QrScanner onScan={handleScan} />
              </div>

              <div className="w-full bg-[#1a1d24] p-5 rounded-2xl border border-white/5 shadow-2xl">
                  <form onSubmit={handleManualSubmit} className="space-y-3">
                      <div className="flex justify-between items-baseline">
                        <label htmlFor="manual-id" className="block text-xs font-bold text-gray-400 uppercase tracking-wider">
                            Ingreso Manual
                        </label>
                        <span className="text-[10px] text-gray-600">¿Problemas con la cámara?</span>
                      </div>
                      <div className="flex gap-2">
                        <input 
                            id="manual-id" 
                            type="text" 
                            placeholder="ID del Vehículo (ej. v1)" 
                            value={manualId} 
                            onChange={e => setManualId(e.target.value)} 
                            className="flex-1 bg-[#0f1115] border border-gray-700 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none placeholder-gray-600 font-medium transition-all" 
                        />
                        <button 
                            type="submit" 
                            className="bg-gradient-to-br from-indigo-600 to-blue-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg hover:shadow-indigo-500/30 transition-all active:scale-95"
                        >
                            Ir
                        </button>
                      </div>
                  </form>
              </div>
          </main>

          <footer className="p-4 pb-8 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/5">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <span className="text-[10px] font-medium text-gray-400">Sistema Operativo v1.0.5</span>
              </div>
          </footer>
      </div>
    );
  }

  return <div>Rol no reconocido</div>;
};

export default App;