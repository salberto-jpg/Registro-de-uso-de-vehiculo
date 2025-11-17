import React, { useState, useEffect } from 'react';
import { Login } from './pages/Login';
import { AdminDashboard } from './pages/AdminDashboard';
import { DriverView } from './pages/DriverView';
import { User, UserRole } from './types';
import { subscribeToAuthChanges, getCurrentUserProfile, updateUserPassword } from './services/db';

const UpdatePasswordView: React.FC<{ onUpdated: () => void }> = ({ onUpdated }) => {
    const [pass, setPass] = useState('');
    const [loading, setLoading] = useState(false);
    const bgImage = "https://wqccvxkbmoqgiiplogew.supabase.co/storage/v1/object/public/imagenes/Gemini_Generated_Image_aaf59jaaf59jaaf5.png";

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

  useEffect(() => {
      const { data: { subscription } } = subscribeToAuthChanges(async (event, session) => {
          if (event === 'PASSWORD_RECOVERY') {
              setIsRecovery(true);
          } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
              if (session?.user && !user) {
                  const profile = await getCurrentUserProfile();
                  if (profile) setUser(profile);
              }
          } else if (event === 'SIGNED_OUT') {
              setUser(null);
              setIsRecovery(false);
          }
      });
      
      getCurrentUserProfile().then(u => {
          if (u) setUser(u);
      });

      return () => subscription.unsubscribe();
  }, []);

  const vehicleMatch = route.match(/#\/vehicle\/(.+)/);
  const vehicleId = vehicleMatch ? vehicleMatch[1] : null;

  const handleManualSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (manualId.trim()) {
          window.location.hash = `/vehicle/${manualId.trim()}`;
      }
  };
  
  const handlePasswordUpdated = async () => {
      setIsRecovery(false);
      const profile = await getCurrentUserProfile();
      if (profile) setUser(profile);
      window.location.hash = '';
  };

  if (isRecovery) {
      return <UpdatePasswordView onUpdated={handlePasswordUpdated} />;
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  if (vehicleId) {
    // onLogout here just means "Exit Driver View", not "Sign Out"
    return <DriverView user={user} vehicleId={vehicleId} onLogout={() => { window.location.hash = ''; }} />;
  }

  if (user.role === UserRole.ADMIN || user.role === UserRole.SUPERVISOR) {
    // Pass the user prop to ensure Admin Dashboard knows who is logged in immediately
    return <AdminDashboard user={user} />;
  }

  if (user.role === UserRole.DRIVER) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col">
          
          <header className="p-6 flex justify-between items-center border-b border-gray-800">
            <div>
              <h1 className="text-white font-bold text-lg">Uso de Vehiculos</h1>
              <p className="text-gray-400 text-sm">Hola, {user.name.split(' ')[0]}</p>
            </div>
            <button onClick={() => setUser(null)} className="text-gray-400 hover:text-white text-sm">Salir</button>
          </header>

          <main className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto w-full">
              <div className="mb-8 p-6 bg-gray-800 rounded-full shadow-lg border border-gray-700">
                  <svg className="w-16 h-16 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 4v1m6 11h2m-6 0h-2v4h-4v-4H8m13-4V7a1 1 0 00-1-1h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4a1 1 0 00-1 1v4a1 1 0 001 1h3.293A1 1 0 017 11.707V19a1 1 0 001 1h8a1 1 0 001-1v-7.586c0-.528.21-1.033.586-1.414l5-5z"></path>
                  </svg>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Listo para escanear</h2>
              <p className="text-gray-400 mb-8">Utiliza la cámara para leer el código QR del vehículo.</p>

              <div className="w-full bg-gray-800 p-6 rounded-xl border border-gray-700">
                  <form onSubmit={handleManualSubmit} className="space-y-4">
                      <label htmlFor="manual-id" className="block text-left text-sm font-medium text-gray-300">¿Problemas con la cámara?</label>
                      <div className="flex gap-2">
                        <input id="manual-id" type="text" placeholder="ID del Vehículo (ej. v1)" value={manualId} onChange={(e) => setManualId(e.target.value)} className="flex-1 bg-gray-900 border border-gray-600 text-white rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                        <button type="submit" className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors">Ir</button>
                      </div>
                  </form>
              </div>
          </main>

          <footer className="p-6 text-center text-gray-600 text-xs">v1.0.3 &bull; Conectado a Supabase</footer>
      </div>
    );
  }

  return <div>Rol no reconocido</div>;
};

export default App;