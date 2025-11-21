
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
  const [route, setRoute] = useState<string>(window.location.hash);
  const [manualId, setManualId] = useState('');
  const [loadingMessage, setLoadingMessage] = useState('Cargando sistema...');
  
  const [isRecovery, setIsRecovery] = useState(() => {
      const h = window.location.hash;
      return h && (h.includes('type=recovery') || h.includes('type=invite'));
  });

  useEffect(() => {
    const handleHashChange = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // --- LÓGICA MAESTRA DE INICIO (FAIL-FAST) ---
  useEffect(() => {
      let isMounted = true;

      const init = async () => {
          console.log("Iniciando aplicación...");
          
          // DETECCIÓN DE FLUJO DE AUTENTICACIÓN (Token en URL)
          // Si hay un token de acceso, es porque el usuario viene de un email de confirmación.
          // NO debemos usar el timeout corto, hay que esperar a Supabase.
          const hash = window.location.href;
          const isAuthRedirect = hash.includes('access_token') || hash.includes('type=signup') || hash.includes('type=recovery') || hash.includes('type=invite');
          
          if (isAuthRedirect) {
              console.log("Detectado flujo de confirmación de correo/recuperación.");
              setLoadingMessage("Verificando cuenta y validando credenciales...");
          }

          try {
              let userProfile: User | null = null;

              if (isAuthRedirect) {
                  // SI ES REDIRECT: Esperamos mucho más (15s) o confiamos en el listener
                  // No usamos Promise.race agresivo aquí para dar tiempo al handshake de token.
                   userProfile = await getCurrentUserProfile();
              } else {
                  // SI ES CARGA NORMAL: Usamos el timeout para no bloquear
                  // Aumentado a 8s para evitar "Timeout de carga inicial" en conexiones lentas
                  const timeoutPromise = new Promise<null>((resolve) => 
                      setTimeout(() => {
                          console.warn("Timeout de carga inicial.");
                          resolve(null);
                      }, 8000)
                  );

                  userProfile = await Promise.race([
                      getCurrentUserProfile(),
                      timeoutPromise
                  ]);
              }

              if (isMounted) {
                  setUser(userProfile);
              }
          } catch (e) {
              console.error("Error en carga inicial:", e);
              if (isMounted) setUser(null);
          } finally {
              if (isMounted) setLoading(false);
          }
      };

      init();

      // Suscripción segura a cambios de sesión
      const sub = subscribeToAuthChanges((event, session) => {
          if (!isMounted) return;
          console.log("Evento Auth:", event);
          
          if (event === 'SIGNED_OUT') {
              setUser(null);
              setLoading(false);
          } else if (event === 'SIGNED_IN') {
               // Si entra (incluso por link de correo), intentamos recargar el perfil
               // Esto es crucial para la confirmación de correo
               if (!user) {
                   setLoading(true);
                   getCurrentUserProfile().then(u => {
                       if (isMounted) {
                           setUser(u);
                           setLoading(false);
                       }
                   });
               }
          } else if (event === 'PASSWORD_RECOVERY') {
              setIsRecovery(true);
          }
      });

      return () => {
          isMounted = false;
          if (sub && sub.data && sub.data.subscription) {
              sub.data.subscription.unsubscribe();
          }
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

  // PANTALLA DE CARGA
  if (loading) {
      return (
          <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 text-gray-600 gap-4">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-300 border-t-indigo-600"></div>
              <p className="font-medium text-sm animate-pulse">{loadingMessage}</p>
              {/* Botón de escape por si acaso */}
              <button 
                  onClick={() => { signOut(); window.location.reload(); }}
                  className="mt-8 text-xs text-gray-400 hover:text-red-500 underline"
              >
                  ¿Tarda mucho? Reiniciar
              </button>
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
                onClick={async () => { 
                    setLoading(true);
                    await signOut(); 
                    window.location.reload(); 
                }} 
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
                  <span className="text-[10px] font-medium text-gray-400">Sistema Operativo v1.0.7</span>
              </div>
          </footer>
      </div>
    );
  }

  return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
          <div className="bg-white p-8 rounded-lg shadow-md max-w-md text-center">
              <h2 className="text-red-500 font-bold text-xl mb-2">Error de Acceso</h2>
              <p className="text-gray-600 mb-4">Tu usuario no tiene un rol asignado válido.</p>
              <button onClick={() => signOut().then(() => window.location.reload())} className="bg-gray-800 text-white px-4 py-2 rounded">Volver al Inicio</button>
          </div>
      </div>
  );
};

export default App;
