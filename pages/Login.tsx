
import React, { useState, useEffect } from 'react';
import { signInWithEmail, resetPassword, getErrorMessage } from '../services/db';
import { User, UserRole } from '../types';
import { isSupabaseConfigured, setupSupabase, disconnectSupabase } from '../services/supabase';

interface LoginProps {
  onLogin: (user: User) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  
  // Setup Config State
  const [showConfig, setShowConfig] = useState(false);
  const [sbUrl, setSbUrl] = useState('');
  const [sbKey, setSbKey] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    setIsConfigured(isSupabaseConfigured());
  }, [showConfig]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMsg('');

    try {
      // --- LOGIN ---
      const { user, error } = await signInWithEmail(email, password);
      if (user) {
        // Force Scanner view for Drivers by clearing any vehicle hash
        if (user.role === UserRole.DRIVER) {
            window.location.hash = '';
        }
        onLogin(user);
      } else {
        setError(error || 'Credenciales inválidas.');
      }
    } catch (err: any) {
      console.error(err);
      const msg = getErrorMessage(err);
      setError(msg || 'Error de conexión.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
        setError("Ingresa tu usuario (email) primero para enviarte el enlace.");
        return;
    }
    setLoading(true);
    setError('');
    setMsg('');

    try {
      const { error, redirectTo } = await resetPassword(email);
      if (error) {
        setError(error.message);
      } else {
        setMsg(`✅ Se ha enviado un enlace a tu correo.`);
      }
    } catch (e: any) {
      const msg = getErrorMessage(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const success = setupSupabase(sbUrl, sbKey);
    if (success) {
      setIsConfigured(true);
      setShowConfig(false);
      setSbUrl('');
      setSbKey('');
    } else {
      alert("URL inválida. Asegúrese de incluir https://");
    }
  };

  const handleDisconnect = () => {
    disconnectSupabase();
    setIsConfigured(false);
    setShowConfig(false);
  };

  const bgImage = "https://wqccvxkbmoqgiiplogew.supabase.co/storage/v1/object/public/imagenes/fondo.png";

  return (
    <div className="min-h-screen flex flex-col items-center justify-end relative font-sans overflow-hidden bg-slate-300">
      
      {/* FULL SCREEN BACKGROUND IMAGE - RESET TO STANDARD POSITIONING */}
      <img 
          src={bgImage}
          alt="Fondo"
          className="absolute inset-0 w-full h-full object-cover object-center md:object-contain md:object-bottom z-0"
      />

      {/* Config Button - Hidden/Discreet */}
      <button 
        onClick={() => setShowConfig(true)}
        className="absolute top-4 right-4 text-white/50 hover:text-white p-2 z-20"
        title="Configurar Base de Datos"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {/* BOTTOM SECTION: FORM OVERLAY */}
      <div className="relative z-10 w-full max-w-2xl px-6 pb-8 sm:pb-12 flex flex-col items-center">
        
        {/* Messages */}
        {error && (
            <div className="w-full text-white text-sm text-center bg-red-600/80 backdrop-blur-sm p-3 rounded-lg mb-4 font-medium shadow-lg border border-red-400/30 max-w-xl">
                {error}
            </div>
        )}
        {msg && (
            <div className="w-full text-white text-sm text-center bg-green-600/80 backdrop-blur-sm p-3 rounded-lg mb-4 font-medium shadow-lg border border-green-400/30 max-w-xl whitespace-pre-line">
                {msg}
            </div>
        )}

        <form className="w-full max-w-xl space-y-4" onSubmit={handleSubmit}>
            
            {/* INPUTS */}
            <div className="flex flex-col sm:flex-row gap-3 w-full">
                <div className="flex-1">
                    <label htmlFor="email-address" className="sr-only">Usuario</label>
                    <input
                        id="email-address"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        className="appearance-none w-full px-4 py-3 rounded-lg border-0 bg-white/90 backdrop-blur-sm text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-md font-normal text-sm sm:text-base transition-all"
                        placeholder="Correo Electrónico"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </div>
                <div className="flex-1">
                    <label htmlFor="password" className="sr-only">Contraseña</label>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        className="appearance-none w-full px-4 py-3 rounded-lg border-0 bg-white/90 backdrop-blur-sm text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-md font-normal text-sm sm:text-base transition-all"
                        placeholder="Contraseña"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </div>
            </div>

            {/* BUTTON: Full width blue button */}
            <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-3.5 px-4 border border-transparent text-base font-bold rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-all shadow-lg uppercase tracking-wider bg-blue-600 hover:bg-blue-700 active:scale-[0.99]"
            >
                {loading ? 'Cargando...' : 'INICIAR SESIÓN'}
            </button>

            {/* FOOTER LINKS */}
            <div className="flex justify-end items-center mt-4 px-1">
                <button 
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs text-white/90 hover:text-white font-medium hover:underline drop-shadow-md"
                >
                    ¿Olvidaste tu contraseña?
                </button>
            </div>
        </form>
      </div>

      {/* Config Modal */}
      {showConfig && (
        <div className="fixed z-50 inset-0 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => setShowConfig(false)}>
              <div className="absolute inset-0 bg-slate-900 opacity-75 backdrop-blur-sm"></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <h3 className="text-lg leading-6 font-medium text-slate-900 mb-4">Configuración de Conexión</h3>
                {isConfigured ? (
                  <div className="space-y-4">
                    <p className="text-sm text-slate-500">La aplicación está conectada a una instancia de Supabase.</p>
                    <button 
                      onClick={handleDisconnect}
                      className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 sm:text-sm"
                    >
                      Desconectar
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSaveConfig} className="space-y-4">
                    <p className="text-sm text-slate-500 mb-4">
                      Ingrese las credenciales de su proyecto Supabase.
                    </p>
                    <div>
                      <label className="block text-sm font-medium text-slate-700">URL</label>
                      <input 
                        required 
                        value={sbUrl}
                        onChange={e => setSbUrl(e.target.value)}
                        className="mt-1 w-full border border-slate-300 rounded-md shadow-sm p-2 text-sm focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700">Anon Key</label>
                      <input 
                        required 
                        value={sbKey}
                        onChange={e => setSbKey(e.target.value)}
                        className="mt-1 w-full border border-slate-300 rounded-md shadow-sm p-2 text-sm focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <button 
                      type="submit"
                      className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 sm:text-sm mt-4"
                    >
                      Guardar y Conectar
                    </button>
                  </form>
                )}
              </div>
              <div className="bg-slate-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button 
                  type="button" 
                  onClick={() => setShowConfig(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-slate-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-slate-700 hover:bg-slate-50 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
