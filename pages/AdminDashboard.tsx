import React, { useEffect, useState } from 'react';
import { getAllVehicles, getAllLogs, createVehicle, updateVehicle, deleteVehicle, getAllUsers, adminCreateUser, adminUpdateUser, resetPassword, signOut, seedDatabase } from '../services/db';
import { generateFleetReport } from '../services/ai';
import { Vehicle, VehicleLog, VehicleStatus, User, UserRole } from '../types';
import { QRCodeDisplay } from '../components/QRCode';
import { BarChart, Bar, XAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface AdminDashboardProps {
    user: User;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ user }) => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [logs, setLogs] = useState<VehicleLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'fleet' | 'logs' | 'users'>('fleet');
  
  // Use prop directly - this is the source of truth
  const currentUser = user;

  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [qrVehicle, setQrVehicle] = useState<Vehicle | null>(null);

  const [aiReport, setAiReport] = useState<string | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);

  // Vehicle Form
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [vFormName, setVFormName] = useState('');
  const [vFormPlate, setVFormPlate] = useState('');
  const [vFormMileage, setVFormMileage] = useState(0);
  const [vFormStatus, setVFormStatus] = useState<VehicleStatus>(VehicleStatus.AVAILABLE);
  const [vFormImage, setVFormImage] = useState('');
  
  // User Form
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [uFormName, setUFormName] = useState('');
  const [uFormEmail, setUFormEmail] = useState('');
  const [uFormRole, setUFormRole] = useState<UserRole>(UserRole.DRIVER);
  const [uFormPassword, setUFormPassword] = useState('');
  const [userError, setUserError] = useState('');
  const [userMsg, setUserMsg] = useState('');

  const [sqlTab, setSqlTab] = useState<'repair' | 'schema'>('repair');
  const [seeding, setSeeding] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
        const [v, l, u] = await Promise.all([getAllVehicles(), getAllLogs(), getAllUsers()]);
        setVehicles(v);
        setLogs(l);
        setUsers(u);
    } catch (e) {
        console.error("Error fetching dashboard data", e);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- ROBUST ADMIN CHECK ---
  const userEmail = currentUser?.email || '';
  const isOwner = userEmail === 'salberto@metallo.com.ar' || userEmail === 'admin@fleet.com';
  const isAdmin = currentUser?.role === UserRole.ADMIN || isOwner;
  const isSupervisor = currentUser?.role === UserRole.SUPERVISOR && !isAdmin;

  const openCreateVehicle = () => {
    setEditingVehicle(null);
    setVFormName('');
    setVFormPlate('');
    setVFormMileage(0);
    setVFormStatus(VehicleStatus.AVAILABLE);
    setVFormImage('');
    setShowVehicleModal(true);
  };

  const openEditVehicle = (v: Vehicle) => {
    setEditingVehicle(v);
    setVFormName(v.name);
    setVFormPlate(v.licensePlate);
    setVFormMileage(v.currentMileage);
    setVFormStatus(v.status);
    setVFormImage(v.imageUrl || '');
    setShowVehicleModal(true);
  };

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
        if (editingVehicle) {
            await updateVehicle({
                ...editingVehicle,
                name: vFormName,
                licensePlate: vFormPlate,
                currentMileage: vFormMileage,
                status: vFormStatus,
                imageUrl: vFormImage
            });
            alert("¡Vehículo actualizado correctamente!");
        } else {
            await createVehicle({
                name: vFormName,
                licensePlate: vFormPlate,
                currentMileage: vFormMileage, 
                status: vFormStatus,
                imageUrl: vFormImage
            });
            alert("¡Vehículo creado correctamente!");
        }
        setShowVehicleModal(false);
        fetchData();
    } catch (error: any) {
        console.error("Error saving vehicle:", error);
        alert(`Error al guardar vehículo: ${error.message || 'Error desconocido'}`);
    }
  };

  const handleDeleteVehicle = async (id: string) => {
    if (window.confirm('¿Está seguro de que desea eliminar este vehículo? Esta acción no se puede deshacer.')) {
        try {
            await deleteVehicle(id);
            alert("Vehículo eliminado.");
            fetchData();
        } catch (e: any) {
            console.error(e);
            alert(`Error al eliminar vehículo: ${e.message}`);
        }
    }
  };

  const openCreateUser = () => {
    setEditingUser(null);
    setUFormName('');
    setUFormEmail('');
    setUFormRole(UserRole.DRIVER);
    setUFormPassword(''); 
    setUserError('');
    setUserMsg('');
    setShowUserModal(true);
  }

  const openEditUser = (u: User) => {
    setEditingUser(u);
    setUFormName(u.name);
    setUFormEmail(u.email);
    setUFormRole(u.role);
    setUFormPassword(''); 
    setUserError('');
    setUserMsg('');
    setShowUserModal(true);
  }

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserError('');
    setUserMsg('');
    try {
        if (editingUser) {
          await adminUpdateUser({
            id: editingUser.id,
            email: editingUser.email, 
            name: uFormName,
            role: uFormRole
          });
          alert("Datos del usuario actualizados.");
        } else {
          if (!uFormPassword || uFormPassword.length < 6) {
              setUserError("La contraseña es obligatoria y debe tener al menos 6 caracteres.");
              return;
          }

          await adminCreateUser({
              email: uFormEmail,
              name: uFormName,
              role: uFormRole
          }, uFormPassword);
          
          alert("Usuario creado correctamente.");
        }
        setShowUserModal(false);
        fetchData();
    } catch (err: any) {
        console.error(err);
        setUserError(`Error al guardar usuario: ${err.message || JSON.stringify(err)}`);
    }
  };

  const handleSendPasswordReset = async () => {
    if (!editingUser || !editingUser.email) return;
    if (!window.confirm(`¿Estás seguro? Esto enviará un correo de recuperación a ${editingUser.email}.`)) return;

    try {
      const { error } = await resetPassword(editingUser.email);
      if (error) throw error;
      setUserMsg("✅ Correo de recuperación enviado exitosamente.");
    } catch (e: any) {
      setUserError("❌ Error al enviar correo: " + e.message);
    }
  }

  const handleLogout = async () => {
    await signOut();
    window.location.reload();
  }

  const handleGenerateAiReport = async () => {
    setLoadingAi(true);
    const report = await generateFleetReport(vehicles, logs);
    setAiReport(report);
    setLoadingAi(false);
  };

  const handleSeedData = async () => {
      setSeeding(true);
      try {
          await seedDatabase();
          alert("✅ Datos de prueba generados correctamente.");
          setShowSqlModal(false);
          fetchData();
      } catch (e: any) {
          alert("Error al generar datos: " + e.message + "\n\nIntenta ejecutar el script de reparación en 'Ayuda DB'.");
      } finally {
          setSeeding(false);
      }
  }

  const handleDownloadQR = async () => {
      if (!qrVehicle) return;
      
      const baseUrl = window.location.href.split('#')[0];
      const targetUrl = `${baseUrl}#/vehicle/${qrVehicle.id}`;
      const qrSize = 500; // High res for download
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize}x${qrSize}&data=${encodeURIComponent(targetUrl)}`;

      try {
          const response = await fetch(qrUrl);
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `QR_${qrVehicle.licensePlate.replace(/\s+/g, '_')}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
      } catch (error) {
          console.error("Error downloading QR:", error);
          window.open(qrUrl, '_blank');
      }
  };

  const calculateDuration = (start: string, end?: string) => {
      const startTime = new Date(start).getTime();
      const endTime = end ? new Date(end).getTime() : new Date().getTime();
      const diffMs = endTime - startTime;
      
      if (diffMs < 0) return "0m"; // Should not happen but for safety

      const hours = Math.floor(diffMs / 3600000);
      const minutes = Math.floor((diffMs % 3600000) / 60000);
      
      const durationStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
      
      if (!end) {
          return `${durationStr}`; // Returns elapsed time for active trips
      }
      return durationStr;
  };

  // SQL Script Content (REPAIR)
  const sqlRepairScript = `-- SCRIPT DE REPARACIÓN MAESTRA V5

-- 1. Limpiar caché y funciones previas
NOTIFY pgrst, 'reload schema';
DROP FUNCTION IF EXISTS create_profile CASCADE;
DROP FUNCTION IF EXISTS is_admin CASCADE;
DROP FUNCTION IF EXISTS manage_vehicle_v5 CASCADE;

-- 2. Asegurar tablas
CREATE TABLE IF NOT EXISTS public.profiles (
    id text PRIMARY KEY,
    email text UNIQUE NOT NULL,
    name text NOT NULL,
    role text NOT NULL CHECK (role IN ('ADMIN', 'DRIVER', 'SUPERVISOR')),
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicles (
    id text PRIMARY KEY,
    name text NOT NULL,
    license_plate text UNIQUE NOT NULL,
    status text NOT NULL CHECK (status IN ('AVAILABLE', 'IN_USE', 'MAINTENANCE')),
    current_mileage integer DEFAULT 0,
    qr_code_url text,
    image_url text,
    notes text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id text REFERENCES public.vehicles(id) ON DELETE SET NULL,
    driver_id text REFERENCES public.profiles(id) ON DELETE SET NULL,
    driver_name text NOT NULL,
    start_time timestamptz DEFAULT now(),
    end_time timestamptz,
    start_mileage integer,
    end_mileage integer,
    notes text,
    created_at timestamptz DEFAULT now()
);

-- 3. FUNCIÓN SEGURA: Gestión de Vehículos
CREATE OR REPLACE FUNCTION public.manage_vehicle_v5(payload jsonb) 
RETURNS json AS $$
DECLARE
  _op text;
  _id text;
  _name text;
  _license_plate text;
  _status text;
  _mileage numeric;
  _image_url text;
  _notes text;
  _result public.vehicles%ROWTYPE;
BEGIN
    _op := payload->>'op';
    _id := payload->>'id';
    _name := payload->>'name';
    _license_plate := payload->>'license_plate';
    _status := payload->>'status';
    
    IF payload->>'mileage' IS NOT NULL AND payload->>'mileage' != '' THEN
       _mileage := (payload->>'mileage')::numeric;
    ELSE
       _mileage := 0;
    END IF;

    _image_url := payload->>'image_url';
    _notes := payload->>'notes';

    IF _op = 'create' THEN
        INSERT INTO public.vehicles (id, name, license_plate, status, current_mileage, image_url, notes)
        VALUES (_id, _name, _license_plate, _status, _mileage::integer, _image_url, _notes)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name, status = EXCLUDED.status, current_mileage = EXCLUDED.current_mileage
        RETURNING * INTO _result;
        RETURN row_to_json(_result);
        
    ELSIF _op = 'update' THEN
        UPDATE public.vehicles
        SET name = _name, license_plate = _license_plate, status = _status, current_mileage = _mileage::integer, image_url = _image_url, notes = _notes
        WHERE id = _id
        RETURNING * INTO _result;
        RETURN row_to_json(_result);
        
    ELSIF _op = 'delete' THEN
        UPDATE public.logs SET vehicle_id = NULL WHERE vehicle_id = _id;
        DELETE FROM public.vehicles WHERE id = _id RETURNING * INTO _result;
        RETURN row_to_json(_result);
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. FUNCIÓN SEGURA: Crear Usuarios
CREATE OR REPLACE FUNCTION public.create_profile(
  _id text,
  _email text,
  _name text,
  _role text
) RETURNS void AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (_id, _email, _name, _role)
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, name = EXCLUDED.name, role = EXCLUDED.role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. FUNCIÓN SEGURA: Verificar Admin
CREATE OR REPLACE FUNCTION public.is_admin() 
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid()::text AND role = 'ADMIN'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. HABILITAR PERMISOS (CRÍTICO)
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.profiles TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.vehicles TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.logs TO postgres, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.manage_vehicle_v5 TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_profile TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin TO postgres, anon, authenticated, service_role;

-- 7. SEGURIDAD (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Policies Profiles" ON public.profiles;
DROP POLICY IF EXISTS "Policies Vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Policies Logs" ON public.logs;

CREATE POLICY "Policies Profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Policies Vehicles" ON public.vehicles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Policies Logs" ON public.logs FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
`;

  const sqlSchemaScript = `-- REINICIO DE FÁBRICA (BORRA TODO)
DROP TABLE IF EXISTS logs CASCADE;
DROP TABLE IF EXISTS vehicles CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
`;

  const handleCopySql = () => {
    const script = sqlTab === 'repair' ? sqlRepairScript : sqlSchemaScript;
    navigator.clipboard.writeText(script);
    alert("Código copiado.");
  };

  const chartData = vehicles.map(v => ({
    name: v.licensePlate,
    viajes: logs.filter(l => l.vehicleId === v.id).length
  }));

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="print:hidden">
        <header className="bg-white shadow">
          <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
            <div>
                <div className="flex items-center gap-4">
                    <h1 className="text-3xl font-bold text-gray-900">Panel de Control</h1>
                    {isSupervisor && <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full font-mono">SUPERVISOR</span>}
                    {isAdmin && <span className="bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded-full font-mono">ADMIN</span>}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                    {userEmail ? `Usuario: ${userEmail}` : 'Cargando...'} 
                </p>
            </div>
            <div className="flex space-x-4 items-center">
              <nav className="flex space-x-2">
                  <button onClick={() => setView('fleet')} className={`px-3 py-2 rounded-md text-sm font-medium ${view === 'fleet' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}>Flota</button>
                  <button onClick={() => setView('logs')} className={`px-3 py-2 rounded-md text-sm font-medium ${view === 'logs' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}>Historial</button>
                  
                  {isAdmin && (
                    <button onClick={() => setView('users')} className={`px-3 py-2 rounded-md text-sm font-medium ${view === 'users' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}>Usuarios</button>
                  )}
              </nav>
              <div className="h-6 w-px bg-gray-300 mx-2"></div>
              
              {isAdmin && (
                <div className="flex gap-1">
                    <button 
                        onClick={fetchData} 
                        className="text-sm text-gray-500 hover:text-gray-800 font-medium flex items-center gap-1 border px-2 py-1 rounded hover:bg-gray-100"
                        title="Recargar Datos"
                    >
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                    </button>
                    <button 
                        onClick={() => setShowSqlModal(true)} 
                        className="text-sm text-gray-500 hover:text-gray-800 font-medium flex items-center gap-1 border px-2 py-1 rounded hover:bg-gray-100"
                        title="Reparar Base de Datos"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        Ayuda DB
                    </button>
                </div>
              )}

              <button onClick={handleLogout} className="text-sm text-red-600 hover:text-red-800 font-medium">Salir</button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          
          {view === 'fleet' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                <div className="bg-white overflow-hidden shadow rounded-lg p-5">
                    <h3 className="text-lg font-medium text-gray-900">Vehículos en Uso</h3>
                    <p className="mt-1 text-3xl font-semibold text-indigo-600">
                    {vehicles.filter(v => v.status === VehicleStatus.IN_USE).length} / {vehicles.length}
                    </p>
                </div>
                
                <div className="bg-white overflow-hidden shadow rounded-lg p-5">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Actividad</h3>
                    <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" hide />
                        <Tooltip />
                        <Bar dataKey="viajes" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-white overflow-hidden shadow rounded-lg p-5 relative">
                    <div className="flex justify-between items-start">
                    <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                        <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                        IA Fleet Insight
                    </h3>
                    <button 
                        onClick={handleGenerateAiReport}
                        disabled={loadingAi}
                        className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded hover:bg-purple-200 disabled:opacity-50"
                    >
                        {loadingAi ? '...' : 'Analizar'}
                    </button>
                    </div>
                    <div className="mt-3 text-sm text-gray-600 h-32 overflow-y-auto custom-scrollbar">
                    {aiReport ? (
                        <p className="whitespace-pre-line">{aiReport}</p>
                    ) : (
                        <p className="text-gray-400 italic">Genera un reporte para obtener insights.</p>
                    )}
                    </div>
                </div>
            </div>
          )}

          {/* INVENTORY - VISIBLE FOR ADMIN ONLY */}
          {view === 'fleet' && isAdmin && (
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
              <div className="px-4 py-5 border-b border-gray-200 sm:px-6 flex justify-between items-center">
                <h3 className="text-lg leading-6 font-medium text-gray-900">Inventario de Vehículos</h3>
                <button 
                    onClick={openCreateVehicle}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700"
                >
                + Nuevo Vehículo
                </button>
              </div>
              {vehicles.length === 0 ? (
                  <div className="p-10 text-center flex flex-col items-center justify-center gap-4">
                      <p className="text-gray-500">No hay vehículos registrados.</p>
                      <button
                            type="button"
                            onClick={handleSeedData}
                            disabled={seeding}
                            className="bg-green-600 text-white px-5 py-3 rounded-md font-bold hover:bg-green-700 shadow-lg flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                            {seeding ? 'Generando...' : 'Generar Datos de Prueba Ahora'}
                        </button>
                        <p className="text-xs text-gray-400">Esto creará 3 vehículos de ejemplo automáticamente.</p>
                  </div>
              ) : (
                <ul className="divide-y divide-gray-200">
                    {vehicles.map((vehicle) => {
                        const activeLog = logs.find(l => l.vehicleId === vehicle.id && !l.endTime);
                        const durationText = activeLog ? calculateDuration(activeLog.startTime) : '';
                        
                        return (
                            <li key={vehicle.id} className="p-4 hover:bg-gray-50 transition">
                                <div className="flex items-center justify-between flex-wrap gap-4">
                                <div className="flex items-center gap-4 flex-1 min-w-0">
                                    <div className="h-12 w-12 rounded-full bg-gray-200 flex-shrink-0 overflow-hidden border border-gray-300">
                                        {vehicle.imageUrl ? (
                                            <img src={vehicle.imageUrl} alt={vehicle.name} className="h-full w-full object-cover" />
                                        ) : (
                                            <div className="h-full w-full flex items-center justify-center text-gray-400">
                                                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-indigo-600 truncate">{vehicle.name}</p>
                                        <div className="flex gap-2 text-xs text-gray-500 mt-1">
                                            <span>{vehicle.licensePlate}</span>
                                            <span>&bull;</span>
                                            <span>{vehicle.currentMileage.toLocaleString()} km</span>
                                        </div>
                                        {activeLog && (
                                            <div className="mt-2 inline-flex items-center gap-2 text-xs bg-amber-50 text-amber-800 px-2 py-1 rounded border border-amber-100">
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                                <strong>En uso por:</strong> {activeLog.driverName} ({durationText})
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                    vehicle.status === VehicleStatus.AVAILABLE ? 'bg-green-100 text-green-800' : 
                                    vehicle.status === VehicleStatus.IN_USE ? 'bg-yellow-100 text-yellow-800' : 
                                    'bg-red-100 text-red-800'}`
                                    }>
                                    {vehicle.status}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button onClick={() => setQrVehicle(vehicle)} className="p-2 text-indigo-600 hover:text-indigo-900 hover:bg-indigo-50 rounded-full" title="Ver QR">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4h-4v-4H8m13-4V7a1 1 0 00-1-1h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4a1 1 0 00-1 1v4a1 1 0 001 1h3.293A1 1 0 017 11.707V19a1 1 0 001 1h8a1 1 0 001-1v-7.586c0-.528.21-1.033.586-1.414l5-5z"></path></svg>
                                    </button>
                                    <button onClick={() => openEditVehicle(vehicle)} className="p-2 text-blue-600 hover:text-blue-900 hover:bg-blue-50 rounded-full" title="Editar">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                                    </button>
                                    <button onClick={() => handleDeleteVehicle(vehicle.id)} className="p-2 text-red-600 hover:text-red-900 hover:bg-red-50 rounded-full" title="Eliminar">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                    </button>
                                </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
              )}
            </div>
          )}

          {view === 'logs' && (
            <div className="flex flex-col">
              <div className="-my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
                <div className="py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8">
                  <div className="shadow overflow-hidden border-b border-gray-200 sm:rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vehículo</th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Conductor</th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Salida</th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Retorno</th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duración</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {logs.length === 0 ? (
                             <tr><td colSpan={5} className="px-6 py-4 text-center text-gray-500">No hay historial registrado</td></tr>
                        ) : logs.map((log) => (
                          <tr key={log.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {vehicles.find(v => v.id === log.vehicleId)?.name || 'Unknown'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{log.driverName}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(log.startTime).toLocaleDateString()} {new Date(log.startTime).toLocaleTimeString()}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {log.endTime ? `${new Date(log.endTime).toLocaleDateString()} ${new Date(log.endTime).toLocaleTimeString()}` : <span className="text-yellow-600 font-semibold">En curso</span>}
                            </td>
                             <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                              {calculateDuration(log.startTime, log.endTime)} {log.endTime ? '' : <span className="text-xs text-yellow-600">(En curso)</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {view === 'users' && isAdmin && (
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
                <div className="px-4 py-5 border-b border-gray-200 sm:px-6 flex justify-between items-center">
                    <div>
                        <h3 className="text-lg leading-6 font-medium text-gray-900">Gestión de Usuarios</h3>
                        <p className="mt-1 text-sm text-gray-500">Usuarios registrados en la App.</p>
                    </div>
                    <button onClick={openCreateUser} className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700">
                        + Crear Usuario
                    </button>
                </div>
                <ul className="divide-y divide-gray-200">
                {users.map((u) => (
                    <li key={u.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{u.name}</p>
                        <p className="text-sm text-gray-500">{u.email}</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                u.role === UserRole.ADMIN ? 'bg-purple-100 text-purple-800' : 
                                u.role === UserRole.SUPERVISOR ? 'bg-blue-100 text-blue-800' : 
                                'bg-gray-100 text-gray-800'}`
                            }>
                                {u.role}
                            </span>
                            <button onClick={() => openEditUser(u)} className="flex items-center gap-1 text-indigo-600 hover:text-indigo-900 text-sm font-bold px-3 py-1.5 rounded-md hover:bg-indigo-50 border border-indigo-200">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                Editar
                            </button>
                        </div>
                    </div>
                    </li>
                ))}
                </ul>
            </div>
          )}

        </main>
      </div>

      {/* VEHICLE MODAL */}
      {showVehicleModal && (
        <div className="fixed z-10 inset-0 overflow-y-auto print:hidden">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => setShowVehicleModal(false)}><div className="absolute inset-0 bg-gray-500 opacity-75"></div></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">{editingVehicle ? 'Editar Vehículo' : 'Registrar Nuevo Vehículo'}</h3>
                <form onSubmit={handleSaveVehicle}>
                    <div className="space-y-4">
                        <div><label className="block text-sm font-medium text-gray-700">Nombre / Modelo</label><input required value={vFormName} onChange={e => setVFormName(e.target.value)} className="mt-1 w-full border border-gray-300 p-2 rounded shadow-sm" /></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="block text-sm font-medium text-gray-700">Patente</label><input required value={vFormPlate} onChange={e => setVFormPlate(e.target.value)} className="mt-1 w-full border border-gray-300 p-2 rounded shadow-sm" /></div>
                            <div><label className="block text-sm font-medium text-gray-700">Kilometraje</label><input required type="number" value={vFormMileage} onChange={e => setVFormMileage(Number(e.target.value))} className="mt-1 w-full border border-gray-300 p-2 rounded shadow-sm" /></div>
                        </div>
                        <div><label className="block text-sm font-medium text-gray-700">Imagen (URL)</label><input value={vFormImage} onChange={e => setVFormImage(e.target.value)} className="mt-1 w-full border border-gray-300 p-2 rounded shadow-sm" /></div>
                        {editingVehicle && (
                             <div><label className="block text-sm font-medium text-gray-700">Estado</label>
                                <select value={vFormStatus} onChange={e => setVFormStatus(e.target.value as VehicleStatus)} className="mt-1 w-full border border-gray-300 p-2 rounded shadow-sm">
                                    <option value={VehicleStatus.AVAILABLE}>Disponible</option>
                                    <option value={VehicleStatus.IN_USE}>En Uso</option>
                                    <option value={VehicleStatus.MAINTENANCE}>Mantenimiento</option>
                                </select>
                            </div>
                        )}
                    </div>
                    <div className="mt-5 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-3 sm:grid-flow-row-dense">
                        <button type="submit" className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 sm:col-start-2 sm:text-sm">Guardar</button>
                        <button type="button" onClick={() => setShowVehicleModal(false)} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 sm:mt-0 sm:col-start-1 sm:text-sm">Cancelar</button>
                    </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* USER MODAL */}
      {showUserModal && (
        <div className="fixed z-10 inset-0 overflow-y-auto print:hidden">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => setShowUserModal(false)}><div className="absolute inset-0 bg-gray-500 opacity-75"></div></div>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <h3 className="text-lg leading-6 font-bold text-gray-900 mb-4">{editingUser ? 'Editar Usuario' : 'Crear Nuevo Usuario'}</h3>
                <form onSubmit={handleSaveUser}>
                    <div className="space-y-5">
                        <div><label className="block text-sm font-medium text-gray-700">Nombre</label><input required value={uFormName} onChange={e => setUFormName(e.target.value)} className="mt-1 w-full border border-gray-300 p-2 rounded" /></div>
                        <div><label className="block text-sm font-medium text-gray-700">Email</label><input required type="email" value={uFormEmail} onChange={e => setUFormEmail(e.target.value)} disabled={!!editingUser} className="mt-1 w-full border border-gray-300 p-2 rounded" /></div>
                        {!editingUser && (
                            <div><label className="block text-sm font-medium text-gray-700">Contraseña</label><input required type="text" value={uFormPassword} onChange={e => setUFormPassword(e.target.value)} className="mt-1 w-full border border-gray-300 p-2 rounded" minLength={6} /></div>
                        )}
                        <div><label className="block text-sm font-medium text-gray-700">Rol</label>
                                <select value={uFormRole} onChange={e => setUFormRole(e.target.value as UserRole)} className="mt-1 w-full border border-gray-300 p-2 rounded bg-white">
                                    <option value={UserRole.DRIVER}>Conductor</option>
                                    <option value={UserRole.SUPERVISOR}>Supervisor</option>
                                    <option value={UserRole.ADMIN}>Administrador</option>
                                </select>
                        </div>
                        {editingUser && (
                           <button type="button" onClick={handleSendPasswordReset} className="text-sm text-red-700 border border-red-300 px-4 py-2 rounded w-full">Enviar Reset Password</button>
                        )}
                        {userError && <p className="text-red-500 text-sm">{userError}</p>}
                        {userMsg && <p className="text-green-500 text-sm">{userMsg}</p>}
                    </div>
                    <div className="mt-6 sm:grid sm:grid-cols-2 sm:gap-3 border-t pt-4">
                        <button type="submit" className="w-full inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-base font-medium text-white hover:bg-indigo-700 sm:col-start-2 sm:text-sm">Guardar</button>
                        <button type="button" onClick={() => setShowUserModal(false)} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50 sm:col-start-1 sm:text-sm">Cancelar</button>
                    </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SQL MODAL */}
      {showSqlModal && (
        <div className="fixed z-50 inset-0 overflow-y-auto print:hidden">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => setShowSqlModal(false)}><div className="absolute inset-0 bg-gray-600 opacity-80"></div></div>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
              <div className="bg-gray-50 px-4 pt-4 sm:px-6 flex border-b border-gray-200 gap-4">
                  <button className={`pb-2 text-sm font-medium ${sqlTab === 'repair' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'}`} onClick={() => setSqlTab('repair')}>Reparar Permisos</button>
                  <button className={`pb-2 text-sm font-medium ${sqlTab === 'schema' ? 'text-red-600 border-b-2 border-red-600' : 'text-gray-500'}`} onClick={() => setSqlTab('schema')}>Reset de Fábrica</button>
              </div>
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                    <textarea readOnly value={sqlTab === 'repair' ? sqlRepairScript : sqlSchemaScript} className="w-full h-48 p-3 border border-gray-300 rounded-md font-mono text-xs bg-gray-50" />
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button type="button" onClick={handleCopySql} className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 sm:ml-3 sm:w-auto sm:text-sm">Copiar SQL</button>
                <button type="button" onClick={() => setShowSqlModal(false)} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm">Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {qrVehicle && (
          <div className="fixed z-50 inset-0 overflow-y-auto print:fixed print:inset-0 print:bg-white print:z-[100]">
             <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0 print:h-full print:p-0">
                 <div className="fixed inset-0 transition-opacity print:hidden" onClick={() => setQrVehicle(null)}><div className="absolute inset-0 bg-gray-600 opacity-80"></div></div>
                 <div className="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md sm:w-full print:shadow-none print:w-full print:max-w-none print:h-full">
                     <div className="bg-white p-6 print:p-0 w-full flex flex-col items-center">
                         <div className="print:hidden w-full flex justify-between mb-4"><h3 className="text-xl font-bold">Tarjeta de Identificación</h3><button onClick={() => setQrVehicle(null)}>X</button></div>
                         <QRCodeDisplay vehicleId={qrVehicle.id} vehicleName={qrVehicle.name} size={200} />
                     </div>
                     <div className="bg-gray-50 px-6 py-4 flex flex-row-reverse gap-3 print:hidden border-t border-gray-100">
                        <button onClick={() => window.print()} className="bg-gray-800 text-white px-4 py-2 rounded">Imprimir</button>
                        <button onClick={handleDownloadQR} className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700">Descargar PNG</button>
                     </div>
                 </div>
             </div>
          </div>
      )}
    </div>
  );
};