
import React, { useEffect, useState } from 'react';
import { getAllVehicles, getAllLogs, createVehicle, updateVehicle, deleteVehicle, getAllUsers, adminCreateUser, adminUpdateUser, adminDeleteUser, resetPassword, signOut, seedDatabase, getErrorMessage } from '../services/db';
import { Vehicle, VehicleLog, VehicleStatus, User, UserRole } from '../types';
import { QRCodeDisplay } from '../components/QRCode';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// --- SQL SCRIPTS CONSTANTS ---
const sqlRepairScript = `-- SCRIPT V40: FIX READ PERMISSIONS (DESBLOQUEO TOTAL LECTURA)
-- Soluciona "Database error finding user" garantizando acceso a perfiles.

-- 1. RE-APLICAR PERMISOS DE ESQUEMA (Reset básico)
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;

-- 2. RESETEAR POLÍTICAS DE PERFILES (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Borrar políticas de versiones anteriores para evitar "Policy already exists"
DROP POLICY IF EXISTS "V39 Read All" ON public.profiles;
DROP POLICY IF EXISTS "V39 Insert" ON public.profiles;
DROP POLICY IF EXISTS "V39 Update" ON public.profiles;
DROP POLICY IF EXISTS "V39 Delete" ON public.profiles;
DROP POLICY IF EXISTS "V38 Read All" ON public.profiles;

-- Crear política maestra de lectura V40 (Lectura pública para autenticados)
CREATE POLICY "V40 Read All" ON public.profiles FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "V40 Insert" ON public.profiles FOR INSERT TO authenticated, anon WITH CHECK (true);
CREATE POLICY "V40 Update" ON public.profiles FOR UPDATE TO authenticated USING (true);
CREATE POLICY "V40 Delete" ON public.profiles FOR DELETE TO authenticated USING (true);

-- 3. RECARGA DE CACHÉ
NOTIFY pgrst, 'reload schema';
`;

const sqlForensicScript = `-- 🗑️ BORRADO FORENSE V41 (Matar Usuarios Zombies)
-- Ejecuta esto para eliminar usuarios que dan error en el panel de Supabase ("Database error loading user").
-- Borra logs, perfil y cuenta de auth ignorando errores de integridad.

-- 1. CREAR FUNCIÓN DE FUERZA BRUTA
CREATE OR REPLACE FUNCTION public.force_delete_by_email(target_email text)
RETURNS text AS $$
DECLARE
  _uid uuid;
  _log_count int;
BEGIN
  -- Buscar el ID real en Auth
  SELECT id INTO _uid FROM auth.users WHERE email = target_email;

  IF _uid IS NULL THEN
     RETURN 'El usuario ' || target_email || ' no existe en Auth.';
  END IF;

  -- 1. Borrar Logs donde aparece (Romper el vínculo)
  DELETE FROM public.logs WHERE driver_id = _uid::text;
  GET DIAGNOSTICS _log_count = ROW_COUNT;
  
  -- 2. Borrar Perfil Público (Si existe)
  DELETE FROM public.profiles WHERE id = _uid::text;

  -- 3. Borrar Identidades de Auth (Obligatorio antes de borrar user)
  DELETE FROM auth.identities WHERE user_id = _uid;

  -- 4. Borrar el Usuario de Auth Definitivamente
  DELETE FROM auth.users WHERE id = _uid;

  RETURN 'Usuario ' || target_email || ' eliminado. Logs borrados: ' || _log_count;
EXCEPTION WHEN OTHERS THEN
  RETURN 'Error borrando: ' || SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.force_delete_by_email TO postgres, anon, authenticated, service_role;

-- =======================================================
-- 👇👇👇 EJECUTA ESTA LÍNEA CAMBIANDO EL EMAIL 👇👇👇
-- =======================================================

SELECT force_delete_by_email('mcovi@metallo.com.ar');
`;

const sqlMassPurgeScript = `-- 💀 PURGA MASIVA V42 (Limpieza Total de Zombies)
-- ESTE SCRIPT BORRA AUTOMÁTICAMENTE A TODOS LOS USUARIOS ROTOS.
-- Identifica a cualquier usuario en Auth que NO tenga un perfil en la tabla 'profiles' y lo elimina.

DO $$
DECLARE
    _user RECORD;
    _counter INT := 0;
BEGIN
    RAISE NOTICE 'Iniciando Purga Masiva...';

    -- Recorrer todos los usuarios en Auth que NO están en Profiles (Zombies)
    FOR _user IN
        SELECT id, email FROM auth.users
        WHERE id NOT IN (SELECT id::uuid FROM public.profiles)
    LOOP
        -- 1. Borrar Logs vinculados (Protección FK)
        DELETE FROM public.logs WHERE driver_id = _user.id::text;

        -- 2. Borrar Identidades de Auth
        DELETE FROM auth.identities WHERE user_id = _user.id;

        -- 3. Borrar el Usuario de Auth
        DELETE FROM auth.users WHERE id = _user.id;

        _counter := _counter + 1;
        RAISE NOTICE 'Eliminado Zombie: %', _user.email;
    END LOOP;

    RAISE NOTICE '---------------------------------------------------';
    RAISE NOTICE 'PURGA COMPLETADA: Se eliminaron % usuarios zombies.', _counter;
    RAISE NOTICE 'Ahora puedes volver a crearlos limpiamente.';
END $$;
`;

const sqlCleanScript = `-- 🧹 LIMPIEZA FINAL (BORRÓN Y CUENTA NUEVA DE VEHÍCULOS)
-- Ejecuta esto para borrar todos los vehículos y empezar de cero.
-- Mantiene los usuarios intactos.

-- 1. BORRAR VEHÍCULOS Y LOGS (Clean Slate)
TRUNCATE TABLE public.logs;
TRUNCATE TABLE public.vehicles CASCADE;

-- 2. REPARAR FUNCIÓN DE GESTIÓN (Asegura que puedas borrar en el futuro)
CREATE OR REPLACE FUNCTION public.manage_vehicle_v5(payload jsonb) 
RETURNS json AS $$
DECLARE
  _op text; _id text; _name text; _license_plate text; _status text;
  _mileage numeric; _image_url text; _notes text; _result public.vehicles%ROWTYPE;
BEGIN
    _op := payload->>'op'; _id := payload->>'id'; 
    _name := payload->>'name'; _license_plate := payload->>'license_plate';
    _status := payload->>'status'; _image_url := payload->>'image_url'; _notes := payload->>'notes';
    
    IF payload->>'mileage' IS NOT NULL AND payload->>'mileage' != '' THEN 
        _mileage := (payload->>'mileage')::numeric; 
    ELSE 
        _mileage := 0; 
    END IF;

    IF _op = 'delete' THEN
        -- Desvincular historial antes de borrar para evitar error FK
        UPDATE public.logs SET vehicle_id = NULL WHERE vehicle_id = _id;
        DELETE FROM public.vehicles WHERE id = _id RETURNING * INTO _result;
        RETURN row_to_json(_result);
    ELSIF _op = 'create' THEN
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
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. PERMISOS PERMISIVOS (Evitar errores de acceso)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clean Policies Profiles" ON public.profiles;
DROP POLICY IF EXISTS "Clean Policies Vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Clean Policies Logs" ON public.logs;

CREATE POLICY "Clean Policies Profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Clean Policies Vehicles" ON public.vehicles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Clean Policies Logs" ON public.logs FOR ALL USING (true) WITH CHECK (true);

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manage_vehicle_v5 TO postgres, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
`;

const sqlSchemaScript = `-- REINICIO DE FÁBRICA (BORRA TODO)
DROP TABLE IF EXISTS logs CASCADE;
DROP TABLE IF EXISTS vehicles CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
-- Limpieza de triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
NOTIFY pgrst, 'reload schema';
`;

const sqlPurgeScript = `-- ☢️ PURGA DE USUARIOS FANTASMAS (V30)
-- Ejecuta esto si tienes problemas de "Usuario ya registrado"

-- 1. Función para borrar un usuario específico por email
CREATE OR REPLACE FUNCTION public.delete_user_by_email(target_email text)
RETURNS void AS $$
BEGIN
  DELETE FROM auth.identities WHERE email = target_email;
  DELETE FROM auth.users WHERE email = target_email;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.delete_user_by_email TO postgres, anon, authenticated, service_role;

-- 2. Limpieza automática de huerfanos (Profiles borrados pero Auth activo)
DELETE FROM auth.users
WHERE id::text NOT IN (SELECT id FROM public.profiles)
AND id != auth.uid(); 

-- INSTRUCCIONES MANUALES:
-- SELECT delete_user_by_email('email_que_falla@ejemplo.com');
`;

interface AdminDashboardProps {
    user: User;
    onOpenScanner: () => void; 
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onOpenScanner }) => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [logs, setLogs] = useState<VehicleLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'logs' | 'fleet' | 'users'>('logs');
  const [fetchError, setFetchError] = useState<string | null>(null);
  
  const currentUser = user;

  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);
  
  const [qrVehicle, setQrVehicle] = useState<Vehicle | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Vehicle Form
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [vFormName, setVFormName] = useState('');
  const [vFormPlate, setVFormPlate] = useState('');
  const [vFormMileage, setVFormMileage] = useState(0);
  const [vFormStatus, setVFormStatus] = useState<VehicleStatus>(VehicleStatus.AVAILABLE);
  const [vFormImage, setVFormImage] = useState('');
  const [vFormNotes, setVFormNotes] = useState('');
  
  // User Form
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [uFormName, setUFormName] = useState('');
  const [uFormEmail, setUFormEmail] = useState('');
  const [uFormRole, setUFormRole] = useState<UserRole>(UserRole.DRIVER);
  const [uFormPassword, setUFormPassword] = useState('');
  const [userError, setUserError] = useState('');
  const [userMsg, setUserMsg] = useState('');

  const [sqlTab, setSqlTab] = useState<'repair' | 'schema' | 'clean' | 'purge' | 'forensic' | 'mass_purge'>('clean'); 
  const [seeding, setSeeding] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setFetchError(null);
    try {
        const [v, l, u] = await Promise.all([getAllVehicles(), getAllLogs(), getAllUsers()]);
        setVehicles(v);
        setLogs(l);
        setUsers(u);
    } catch (e: any) {
        console.error("Error fetching dashboard data", e);
        const msg = getErrorMessage(e);
        setFetchError(msg);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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
    setVFormNotes('');
    setShowVehicleModal(true);
  };

  const openEditVehicle = (v: Vehicle) => {
    setEditingVehicle(v);
    setVFormName(v.name);
    setVFormPlate(v.licensePlate);
    setVFormMileage(v.currentMileage);
    setVFormStatus(v.status);
    setVFormImage(v.imageUrl || '');
    setVFormNotes(v.notes || '');
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
                imageUrl: vFormImage,
                notes: vFormNotes
            });
            alert("¡Vehículo actualizado correctamente!");
        } else {
            await createVehicle({
                name: vFormName,
                licensePlate: vFormPlate,
                currentMileage: vFormMileage, 
                status: vFormStatus,
                imageUrl: vFormImage,
                notes: vFormNotes
            });
            alert("¡Vehículo creado correctamente!");
        }
        setShowVehicleModal(false);
        fetchData();
    } catch (error: any) {
        console.error("Error saving vehicle:", error);
        const msg = getErrorMessage(error);
        alert(`Error al guardar vehículo: ${msg}`);
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
            const msg = getErrorMessage(e);
            alert(`Error al eliminar vehículo: ${msg}`);
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
          // Si hay contraseña, actualizamos también la contraseña
          if (uFormPassword && uFormPassword.length > 0) {
              if (uFormPassword.length < 6) {
                  setUserError("La contraseña debe tener al menos 6 caracteres.");
                  return;
              }
              // Llamada para resetear password manual
              const { adminResetUserPassword } = await import('../services/db');
              await adminResetUserPassword(editingUser.id, uFormPassword);
              setUserMsg(prev => prev + " Contraseña actualizada.");
          }

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
          
          alert("✅ Usuario creado exitosamente.\n\nSe ha enviado un correo de confirmación a " + uFormEmail + ". El usuario deberá confirmar su cuenta antes de iniciar sesión.");
        }
        setShowUserModal(false);
        fetchData();
    } catch (err: any) {
        console.error(err);
        const msg = getErrorMessage(err);
        setUserError(`Error: ${msg}`);
    }
  };

  const handleDeleteUser = async (u: User) => {
      if (u.email === currentUser.email) {
          alert("No puedes eliminarte a ti mismo.");
          return;
      }
      if (!window.confirm(`ATENCIÓN: Se eliminará completamente a ${u.name}.\n\nEsto borrará su acceso (Auth) y su perfil. ¿Continuar?`)) {
          return;
      }
      try {
          await adminDeleteUser(u.id);
          alert(`Usuario ${u.name} eliminado correctamente.`);
          fetchData();
      } catch (e: any) {
          console.error(e);
          const msg = getErrorMessage(e);
          alert("Error al eliminar: " + msg + "\n\nTip: Ejecuta el script de Reparación V35 en Ayuda DB.");
      }
  };

  const handleSendPasswordReset = async (emailOverride?: string) => {
    const targetEmail = emailOverride || editingUser?.email;
    if (!targetEmail) return;

    if (!emailOverride && !window.confirm(`¿Enviar correo de recuperación a ${targetEmail}?`)) return;

    try {
      const { error } = await resetPassword(targetEmail);
      if (error) throw error;
      alert(`✅ Correo enviado a ${targetEmail}.`);
      if (editingUser) setUserMsg("✅ Correo enviado.");
    } catch (e: any) {
      console.error(e);
      const msg = getErrorMessage(e);
      alert("❌ Error al enviar correo: " + msg);
      if (editingUser) setUserError("Error: " + msg);
    }
  }

  const handleLogout = async () => {
    await signOut();
    window.location.reload();
  }

  const handleSeedData = async () => {
      setSeeding(true);
      try {
          await seedDatabase();
          alert("✅ Datos de prueba generados correctamente.");
          setShowSqlModal(false);
          fetchData();
      } catch (e: any) {
          const msg = getErrorMessage(e);
          alert("Error al generar datos: " + msg + "\n\nIntenta ejecutar el script de reparación en 'Ayuda DB'.");
      } finally {
          setSeeding(false);
      }
  }

  // --- GENERADOR DE FICHA QR PROFESIONAL (CANVAS) ---
  const handleDownloadQR = async () => {
      if (!qrVehicle) return;
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = 600;
      const height = 800;
      canvas.width = width;
      canvas.height = height;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      
      ctx.strokeStyle = '#e2e8f0'; 
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, width-2, height-2);

      ctx.fillStyle = '#1e3a8a'; 
      ctx.font = 'bold 48px sans-serif'; 
      ctx.textAlign = 'center';
      
      const nameText = qrVehicle.name.toUpperCase();
      ctx.fillText(nameText, width / 2, 80);

      ctx.fillStyle = '#64748b';
      ctx.font = '24px sans-serif';
      ctx.fillText('Escanea para registrar uso', width / 2, 120);

      const baseUrl = window.location.href.split('#')[0];
      const targetUrl = `${baseUrl}#/vehicle/${qrVehicle.id}`;
      const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(targetUrl)}&size=500&margin=1`;

      try {
          const response = await fetch(qrUrl);
          const blob = await response.blob();
          const imgBitmap = await createImageBitmap(blob);

          const qrSize = 450;
          const qrX = (width - qrSize) / 2;
          const qrY = 160;
          
          ctx.lineWidth = 8;
          ctx.strokeStyle = '#0f172a'; 
          ctx.strokeRect(qrX - 5, qrY - 5, qrSize + 10, qrSize + 10);
          
          ctx.drawImage(imgBitmap, qrX, qrY, qrSize, qrSize);

      } catch (error) {
          console.error("Error loading QR image for canvas", error);
          alert("Error generando imagen. Intente de nuevo.");
          return;
      }

      const pillWidth = 400;
      const pillHeight = 60;
      const pillX = (width - pillWidth) / 2;
      const pillY = 680;
      const radius = 30;

      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillWidth, pillHeight, radius);
      ctx.fillStyle = '#f1f5f9'; 
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0'; 
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#334155'; 
      ctx.font = 'bold 32px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(qrVehicle.id, width / 2, pillY + (pillHeight/2) + 2); 

      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `Ficha_${qrVehicle.name.replace(/\s+/g, '_')}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const calculateDuration = (start: string, end?: string) => {
      const startTime = new Date(start).getTime();
      const endTime = end ? new Date(end).getTime() : new Date().getTime();
      const diffMs = endTime - startTime;
      
      if (diffMs < 0) return "0m"; 

      const hours = Math.floor(diffMs / 3600000);
      const minutes = Math.floor((diffMs % 3600000) / 60000);
      
      const durationStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
      
      if (!end) {
          return `${durationStr}`; 
      }
      return durationStr;
  };

  const handleCopySql = () => {
    let script = sqlRepairScript;
    if (sqlTab === 'schema') script = sqlSchemaScript;
    if (sqlTab === 'clean') script = sqlCleanScript;
    if (sqlTab === 'purge') script = sqlPurgeScript;
    if (sqlTab === 'forensic') script = sqlForensicScript;
    if (sqlTab === 'mass_purge') script = sqlMassPurgeScript;
    
    navigator.clipboard.writeText(script);
    alert("Código copiado. Pégalo en el Editor SQL de Supabase y dale a RUN.");
  };

  const chartData = vehicles.map(v => ({
    name: v.licensePlate,
    viajes: logs.filter(l => l.vehicleId === v.id).length,
    modelo: v.name
  }));

  const totalVehicles = vehicles.length;
  const vehiclesInUse = vehicles.filter(v => v.status === VehicleStatus.IN_USE).length;
  const vehiclesAvailable = vehicles.filter(v => v.status === VehicleStatus.AVAILABLE).length;

  // Lógica de separación de logs
  const activeLogs = logs.filter(l => !l.endTime);
  const historyLogs = logs.filter(l => !!l.endTime);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="print:hidden">
        <header className="bg-white shadow-sm border-b border-slate-200">
          <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
            <div className="flex items-center gap-6">
                <img 
                    src="https://wqccvxkbmoqgiiplogew.supabase.co/storage/v1/object/public/imagenes/metallo_oficial_logo-removebg-preview.png" 
                    alt="Metallo Logo" 
                    className="h-24 w-auto object-contain" 
                />
                <div className="h-8 w-px bg-slate-200 hidden sm:block"></div>
                <div className="hidden sm:flex items-center gap-2">
                    {isSupervisor && <span className="bg-blue-100 text-blue-800 text-xs px-2.5 py-0.5 rounded-full font-bold border border-blue-200">SUPERVISOR</span>}
                    {isAdmin && <span className="bg-slate-100 text-slate-800 text-xs px-2.5 py-0.5 rounded-full font-bold border border-slate-200">ADMINISTRADOR</span>}
                </div>
            </div>

            <div className="flex items-center gap-4">
                <button 
                    onClick={onOpenScanner}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-4 py-2 rounded-lg shadow-sm transition-all transform active:scale-95"
                    title="Ir al modo conductor"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4h-4v-4H8m13-4V7a1 1 0 00-1-1h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4a1 1 0 00-1 1v4a1 1 0 001 1h3.293A1 1 0 017 11.707V19a1 1 0 001 1h8a1 1 0 001-1v-7.586c0-.528.21-1.033.586-1.414l5-5z"></path></svg>
                    <span className="hidden sm:inline">Modo Escáner</span>
                </button>

                {isAdmin && (
                <button 
                    onClick={() => setShowSqlModal(true)} 
                    className="text-sm text-slate-500 hover:text-blue-600 font-medium flex items-center gap-1 hover:bg-slate-50 px-3 py-1.5 rounded-md transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    Ayuda DB
                </button>
                )}
                <div className="h-8 w-px bg-slate-200"></div>
                <button onClick={handleLogout} className="text-sm text-red-600 hover:text-red-700 font-bold">Salir</button>
            </div>
          </div>
        </header>

        <div className="bg-white border-b border-slate-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex space-x-8">
                    <button onClick={() => setView('logs')} className={`py-4 px-1 border-b-2 font-medium text-sm ${view === 'logs' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}>
                        Historial de Viajes
                    </button>
                    <button onClick={() => setView('fleet')} className={`py-4 px-1 border-b-2 font-medium text-sm ${view === 'fleet' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}>
                        Gestión de Flota
                    </button>
                    {isAdmin && (
                    <button onClick={() => setView('users')} className={`py-4 px-1 border-b-2 font-medium text-sm ${view === 'users' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}>
                        Usuarios
                    </button>
                    )}
                </div>
            </div>
        </div>

        <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          
          {fetchError && (
              <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 shadow-sm rounded-r-md">
                  <div className="flex">
                      <div className="flex-shrink-0">
                          <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                      </div>
                      <div className="ml-3">
                          <p className="text-sm text-red-700">{fetchError}</p>
                      </div>
                  </div>
              </div>
          )}
          
          {view === 'fleet' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white overflow-hidden shadow-sm rounded-xl border border-slate-100 p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Total Vehículos</p>
                            <p className="mt-1 text-3xl font-bold text-slate-900">{totalVehicles}</p>
                        </div>
                        <div className="p-3 bg-slate-100 rounded-full text-slate-600">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                        </div>
                    </div>
                    
                    <div className="bg-white overflow-hidden shadow-sm rounded-xl border border-slate-100 p-6 flex items-center justify-between relative overflow-hidden">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500"></div>
                        <div>
                            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">En Uso (Activos)</p>
                            <p className="mt-1 text-3xl font-bold text-blue-600">{vehiclesInUse}</p>
                        </div>
                        <div className="p-3 bg-blue-50 rounded-full text-blue-600">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                        </div>
                    </div>

                    <div className="bg-white overflow-hidden shadow-sm rounded-xl border border-slate-100 p-6 flex items-center justify-between relative overflow-hidden">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500"></div>
                        <div>
                            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Disponibles</p>
                            <p className="mt-1 text-3xl font-bold text-green-600">{vehiclesAvailable}</p>
                        </div>
                        <div className="p-3 bg-green-50 rounded-full text-green-600">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                        </div>
                    </div>
                </div>

                <div className="bg-white shadow-sm rounded-xl border border-slate-100 p-6 mb-8">
                    <h3 className="text-lg font-bold text-slate-800 mb-6">Actividad de la Flota (Total Viajes)</h3>
                    <div className="h-80 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                                <Tooltip 
                                    cursor={{fill: '#f8fafc'}}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Bar dataKey="viajes" fill="#2563eb" radius={[4, 4, 0, 0]} barSize={40} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </>
          )}

          {view === 'fleet' && isAdmin && (
            <div className="bg-white shadow-sm rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <h3 className="text-lg leading-6 font-bold text-slate-800">Inventario de Vehículos</h3>
                <div className="flex gap-2">
                    {vehicles.length === 0 && (
                         <button
                            type="button"
                            onClick={handleSeedData}
                            disabled={seeding}
                            className="text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-lg text-sm font-bold transition-colors border border-blue-200"
                        >
                            {seeding ? 'Restaurando...' : '♻️ Restaurar Vehículos'}
                        </button>
                    )}
                    <button 
                        onClick={openCreateVehicle}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition shadow-sm flex items-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                        Nuevo Vehículo
                    </button>
                </div>
              </div>
              {vehicles.length === 0 && !fetchError ? (
                  <div className="p-12 text-center flex flex-col items-center justify-center gap-4">
                      <div className="bg-slate-100 p-4 rounded-full text-slate-400">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                      </div>
                      <p className="text-slate-500 font-medium">No hay vehículos registrados.</p>
                      <p className="text-sm text-slate-400">Si se borraron, usa el botón "Restaurar Vehículos" arriba.</p>
                  </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                    {vehicles.map((vehicle) => {
                        const activeLog = logs.find(l => l.vehicleId === vehicle.id && !l.endTime);
                        const durationText = activeLog ? calculateDuration(activeLog.startTime) : '';
                        
                        return (
                            <li key={vehicle.id} className="p-6 hover:bg-slate-50 transition-colors duration-150">
                                <div className="flex items-center justify-between flex-wrap gap-6">
                                <div className="flex items-center gap-6 flex-1 min-w-0">
                                    <div 
                                      className="h-24 w-40 rounded-lg bg-white flex-shrink-0 overflow-hidden border border-slate-200 relative shadow-sm group cursor-pointer"
                                      onClick={() => vehicle.imageUrl && setPreviewImage(vehicle.imageUrl)}
                                    >
                                        {vehicle.imageUrl ? (
                                            <img src={vehicle.imageUrl} alt={vehicle.name} className="h-full w-full object-contain p-1 transition-transform duration-500 group-hover:scale-105" />
                                        ) : (
                                            <div className="h-full w-full flex items-center justify-center text-slate-300 bg-slate-50">
                                                <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-3 mb-1">
                                            <h4 className="text-lg font-bold text-slate-900">{vehicle.name}</h4>
                                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                                                vehicle.status === VehicleStatus.AVAILABLE ? 'bg-green-50 text-green-700 border-green-100' : 
                                                vehicle.status === VehicleStatus.IN_USE ? 'bg-blue-50 text-blue-700 border-blue-100' : 
                                                'bg-red-50 text-red-700 border-red-100'}`
                                            }>
                                                {vehicle.status === VehicleStatus.IN_USE ? 'En Uso' : 
                                                 vehicle.status === VehicleStatus.AVAILABLE ? 'Disponible' : 'Mantenimiento'}
                                            </span>
                                        </div>
                                        <div className="flex flex-col gap-1 text-sm text-slate-500">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-slate-700 font-semibold bg-slate-100 px-2 py-0.5 rounded text-xs">{vehicle.licensePlate}</span>
                                                <span className="text-slate-400">•</span>
                                                <span>{vehicle.currentMileage.toLocaleString()} km</span>
                                            </div>
                                        </div>
                                        {activeLog && (
                                            <div className="mt-3 inline-flex items-center gap-2 text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg border border-blue-100 font-medium">
                                                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                                                Conductor: {activeLog.driverName} <span className="text-blue-400">|</span> Tiempo: {durationText}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button onClick={() => setQrVehicle(vehicle)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors" title="Ver QR">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4h-4v-4H8m13-4V7a1 1 0 00-1-1h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4a1 1 0 00-1 1v4a1 1 0 001 1h3.293A1 1 0 017 11.707V19a1 1 0 001 1h8a1 1 0 001-1v-7.586c0-.528.21-1.033.586-1.414l5-5z"></path></svg>
                                    </button>
                                    <button onClick={() => openEditVehicle(vehicle)} className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors" title="Editar">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                                    </button>
                                    <button onClick={() => handleDeleteVehicle(vehicle.id)} className="p-2 text-red-400 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar">
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
            <div className="flex flex-col gap-10">
              {/* SECCIÓN SUPERIOR: VIAJES EN CURSO (ESTILO TARJETAS) */}
              <section>
                <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <span className="w-2 h-6 bg-blue-500 rounded-sm"></span>
                    Viajes en Curso
                    <span className="text-xs font-normal text-slate-500 bg-slate-100 px-2 py-1 rounded-full ml-2">
                        {activeLogs.length} Activos
                    </span>
                </h3>

                {activeLogs.length === 0 ? (
                    <div className="bg-white p-8 rounded-xl border border-slate-200 text-center shadow-sm">
                        <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3">
                            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                        </div>
                        <p className="text-slate-500 font-medium">No hay vehículos en uso actualmente.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {activeLogs.map(log => {
                            const vehicle = vehicles.find(v => v.id === log.vehicleId);
                            const startDate = new Date(log.startTime);
                            const today = new Date();
                            const isDifferentDay = startDate.getDate() !== today.getDate() || 
                                                 startDate.getMonth() !== today.getMonth() || 
                                                 startDate.getFullYear() !== today.getFullYear();

                            // Estilos dinámicos según urgencia
                            const borderColor = isDifferentDay ? 'border-red-400' : 'border-blue-400';
                            const bgColor = isDifferentDay ? 'bg-red-50' : 'bg-white';
                            const badgeColor = isDifferentDay ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700';
                            
                            return (
                                <div key={log.id} className={`rounded-xl border-l-4 ${borderColor} ${bgColor} shadow-sm p-5 relative overflow-hidden group hover:shadow-md transition-shadow`}>
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h4 className="font-bold text-slate-900 text-lg leading-tight">{vehicle?.name || 'Vehículo desconocido'}</h4>
                                            <p className="font-mono text-sm text-slate-500 mt-1">{vehicle?.licensePlate}</p>
                                        </div>
                                        <div className={`px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider ${badgeColor}`}>
                                            {isDifferentDay ? '⚠️ NO DEVUELTO' : 'EN CURSO'}
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold">
                                            {log.driverName.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-400 uppercase font-bold">Conductor</p>
                                            <p className="text-sm font-semibold text-slate-800">{log.driverName}</p>
                                        </div>
                                    </div>

                                    <div className="border-t border-slate-200/60 pt-3 flex justify-between items-center text-sm">
                                        <div>
                                            <p className="text-slate-400 text-xs">Inicio</p>
                                            <p className="font-medium text-slate-700">{startDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} <span className="text-xs text-slate-400">{startDate.toLocaleDateString()}</span></p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-slate-400 text-xs">Duración</p>
                                            <p className="font-bold text-slate-800">{calculateDuration(log.startTime)}</p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
              </section>

              {/* SECCIÓN INFERIOR: HISTORIAL DE VIAJES CERRADOS (TABLA LIMPIA) */}
              <section>
                 <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <span className="w-2 h-6 bg-slate-300 rounded-sm"></span>
                    Historial Cerrado
                </h3>
                
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                            <tr>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Vehículo</th>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Conductor</th>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Salida</th>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Retorno</th>
                            <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Duración</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                            {historyLogs.length === 0 ? (
                                <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">No hay registros históricos aún.</td></tr>
                            ) : historyLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-700">
                                    {vehicles.find(v => v.id === log.vehicleId)?.name || 'Unknown'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{log.driverName}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                                    {new Date(log.startTime).toLocaleDateString()} <span className="text-xs text-slate-400">{new Date(log.startTime).toLocaleTimeString()}</span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                                    {log.endTime && (
                                        <span>{new Date(log.endTime).toLocaleDateString()} <span className="text-xs text-slate-400">{new Date(log.endTime).toLocaleTimeString()}</span></span>
                                    )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 font-mono bg-slate-50/50">
                                    {calculateDuration(log.startTime, log.endTime)}
                                </td>
                            </tr>
                            ))}
                        </tbody>
                        </table>
                    </div>
                </div>
              </section>
            </div>
          )}

          {view === 'users' && isAdmin && (
            <div className="bg-white shadow-sm rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
                    <div>
                        <h3 className="text-lg leading-6 font-bold text-slate-800">Gestión de Usuarios</h3>
                        <p className="mt-1 text-sm text-slate-500">Administración de personal y roles.</p>
                    </div>
                    <button onClick={openCreateUser} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition shadow-sm">
                        + Crear Usuario
                    </button>
                </div>
                <ul className="divide-y divide-slate-100">
                {users.map((u) => (
                    <li key={u.id} className="p-4 hover:bg-slate-50">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{u.name}</p>
                        <p className="text-sm text-slate-500">{u.email}</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <span className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-bold rounded-full border ${
                                u.role === UserRole.ADMIN ? 'bg-slate-100 text-slate-800 border-slate-200' : 
                                u.role === UserRole.SUPERVISOR ? 'bg-blue-100 text-blue-800 border-blue-200' : 
                                'bg-white text-slate-600 border-slate-200'}`
                            }>
                                {u.role}
                            </span>
                            <button onClick={() => handleSendPasswordReset(u.email)} className="text-slate-400 hover:text-blue-600 text-xs font-semibold px-2 py-1 border border-slate-200 rounded hover:bg-slate-50 transition-colors" title="Reenviar Mail">
                                📧 Reset
                            </button>
                            <button onClick={() => openEditUser(u)} className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm font-semibold px-3 py-1.5 rounded-md hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-colors">
                                Editar
                            </button>
                            <button onClick={() => handleDeleteUser(u)} className="p-2 text-red-400 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar Usuario">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
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

      {showVehicleModal && (
        <div className="fixed z-50 inset-0 overflow-y-auto print:hidden">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => setShowVehicleModal(false)}><div className="absolute inset-0 bg-slate-900 opacity-75 backdrop-blur-sm"></div></div>
            <div className="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <h3 className="text-lg leading-6 font-bold text-slate-900 mb-4">{editingVehicle ? 'Editar Vehículo' : 'Registrar Nuevo Vehículo'}</h3>
                <form onSubmit={handleSaveVehicle}>
                    <div className="space-y-4">
                        <div><label className="block text-sm font-bold text-slate-700 mb-1">Nombre / Modelo</label><input required value={vFormName} onChange={e => setVFormName(e.target.value)} className="w-full border border-slate-300 p-2.5 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" /></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="block text-sm font-bold text-slate-700 mb-1">Patente</label><input required value={vFormPlate} onChange={e => setVFormPlate(e.target.value)} className="w-full border border-slate-300 p-2.5 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" /></div>
                            <div><label className="block text-sm font-bold text-slate-700 mb-1">Kilometraje</label><input required type="number" value={vFormMileage} onChange={e => setVFormMileage(Number(e.target.value))} className="w-full border border-slate-300 p-2.5 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" /></div>
                        </div>
                        <div><label className="block text-sm font-bold text-slate-700 mb-1">Imagen (URL)</label><input value={vFormImage} onChange={e => setVFormImage(e.target.value)} className="w-full border border-slate-300 p-2.5 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" placeholder="https://..." /></div>
                        
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Notas / Detalle de Mantenimiento</label>
                            <textarea 
                                value={vFormNotes} 
                                onChange={e => setVFormNotes(e.target.value)} 
                                className="w-full border border-slate-300 p-2.5 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                                placeholder="Escribe aquí los detalles del servicio o reparación..."
                                rows={3}
                            />
                        </div>

                        {editingVehicle && (
                             <div><label className="block text-sm font-bold text-slate-700 mb-1">Estado</label>
                                <select value={vFormStatus} onChange={e => setVFormStatus(e.target.value as VehicleStatus)} className="w-full border border-slate-300 p-2.5 rounded-lg shadow-sm bg-white">
                                    <option value={VehicleStatus.AVAILABLE}>Disponible</option>
                                    <option value={VehicleStatus.IN_USE}>En Uso</option>
                                    <option value={VehicleStatus.MAINTENANCE}>Mantenimiento</option>
                                </select>
                            </div>
                        )}
                    </div>
                    <div className="mt-8 sm:flex sm:flex-row-reverse gap-3">
                        <button type="submit" className="w-full inline-flex justify-center rounded-lg border border-transparent shadow-sm px-4 py-2.5 bg-blue-600 text-base font-bold text-white hover:bg-blue-700 sm:w-auto sm:text-sm">Guardar</button>
                        <button type="button" onClick={() => setShowVehicleModal(false)} className="mt-3 w-full inline-flex justify-center rounded-lg border border-slate-300 shadow-sm px-4 py-2.5 bg-white text-base font-bold text-slate-700 hover:bg-slate-50 sm:mt-0 sm:w-auto sm:text-sm">Cancelar</button>
                    </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {showUserModal && (
        <div className="fixed z-50 inset-0 overflow-y-auto print:hidden">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => setShowUserModal(false)}><div className="absolute inset-0 bg-slate-900 opacity-75 backdrop-blur-sm"></div></div>
            <div className="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <h3 className="text-lg leading-6 font-bold text-slate-900 mb-6">{editingUser ? 'Editar Usuario' : 'Crear Nuevo Usuario'}</h3>
                <form onSubmit={handleSaveUser}>
                    <div className="space-y-5">
                        <div><label className="block text-sm font-bold text-slate-700 mb-1">Nombre</label><input required value={uFormName} onChange={e => setUFormName(e.target.value)} className="w-full border border-slate-300 p-2.5 rounded-lg outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500" /></div>
                        <div><label className="block text-sm font-bold text-slate-700 mb-1">Email</label><input required type="email" value={uFormEmail} onChange={e => setUFormEmail(e.target.value)} disabled={!!editingUser} className="w-full border border-slate-300 p-2.5 rounded-lg outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500" /></div>
                        {!editingUser && (
                            <div><label className="block text-sm font-bold text-slate-700 mb-1">Contraseña</label><input required type="text" value={uFormPassword} onChange={e => setUFormPassword(e.target.value)} className="w-full border border-slate-300 p-2.5 rounded-lg outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500" minLength={6} /></div>
                        )}
                        <div><label className="block text-sm font-bold text-slate-700 mb-1">Rol</label>
                                <select value={uFormRole} onChange={e => setUFormRole(e.target.value as UserRole)} className="w-full border border-slate-300 p-2.5 rounded-lg bg-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500">
                                    <option value={UserRole.DRIVER}>Conductor</option>
                                    <option value={UserRole.SUPERVISOR}>Supervisor</option>
                                    <option value={UserRole.ADMIN}>Administrador</option>
                                </select>
                        </div>
                        {editingUser && (
                           <button type="button" onClick={() => handleSendPasswordReset()} className="text-sm text-blue-700 border border-blue-200 hover:bg-blue-50 px-4 py-2.5 rounded-lg w-full font-medium transition-colors">Enviar Email de Recuperación</button>
                        )}
                        {userError && <p className="text-red-500 text-sm font-medium bg-red-50 p-2 rounded whitespace-pre-line">{userError}</p>}
                        {userMsg && <p className="text-green-600 text-sm font-medium bg-green-50 p-2 rounded">{userMsg}</p>}
                    </div>
                    <div className="mt-8 sm:flex sm:flex-row-reverse gap-3 border-t pt-6 border-slate-100">
                        <button type="submit" className="w-full inline-flex justify-center rounded-lg border border-transparent bg-blue-600 px-4 py-2.5 text-base font-bold text-white hover:bg-blue-700 sm:w-auto sm:text-sm shadow-sm">Guardar</button>
                        <button type="button" onClick={() => setShowUserModal(false)} className="mt-3 w-full inline-flex justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-base font-bold text-slate-700 hover:bg-slate-50 sm:mt-0 sm:w-auto sm:text-sm">Cancelar</button>
                    </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSqlModal && (
        <div className="fixed z-50 inset-0 overflow-y-auto print:hidden">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => setShowSqlModal(false)}><div className="absolute inset-0 bg-slate-900 opacity-80 backdrop-blur-sm"></div></div>
            <div className="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
              <div className="bg-slate-50 px-4 pt-4 sm:px-6 flex border-b border-slate-200 gap-6 overflow-x-auto">
                  <button className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${sqlTab === 'clean' ? 'text-green-600 border-green-600' : 'text-slate-500 border-transparent hover:text-slate-700'}`} onClick={() => setSqlTab('clean')}>🧹 LIMPIEZA FINAL</button>
                  <button className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${sqlTab === 'repair' ? 'text-blue-600 border-blue-600' : 'text-slate-500 border-transparent hover:text-slate-700'}`} onClick={() => setSqlTab('repair')}>Reparar Permisos</button>
                  <button className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${sqlTab === 'purge' ? 'text-orange-600 border-orange-600' : 'text-slate-500 border-transparent hover:text-slate-700'}`} onClick={() => setSqlTab('purge')}>☢️ PURGAR AUTH</button>
                  <button className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${sqlTab === 'forensic' ? 'text-red-600 border-red-600' : 'text-slate-500 border-transparent hover:text-slate-700'}`} onClick={() => setSqlTab('forensic')}>🗑️ BORRADO FORENSE</button>
                  <button className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${sqlTab === 'mass_purge' ? 'text-indigo-600 border-indigo-600' : 'text-slate-500 border-transparent hover:text-slate-700'}`} onClick={() => setSqlTab('mass_purge')}>💀 PURGA MASIVA</button>
                  <button className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${sqlTab === 'schema' ? 'text-slate-600 border-slate-600' : 'text-slate-500 border-transparent hover:text-slate-700'}`} onClick={() => setSqlTab('schema')}>Reset de Fábrica</button>
              </div>
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                    <textarea readOnly value={
                        sqlTab === 'repair' ? sqlRepairScript : 
                        sqlTab === 'clean' ? sqlCleanScript : 
                        sqlTab === 'purge' ? sqlPurgeScript :
                        sqlTab === 'forensic' ? sqlForensicScript :
                        sqlTab === 'mass_purge' ? sqlMassPurgeScript :
                        sqlSchemaScript
                    } className="w-full h-64 p-4 border border-slate-200 rounded-lg font-mono text-xs bg-slate-50 text-slate-700 focus:outline-none" />
                    
                    {sqlTab === 'clean' && <p className="text-xs text-green-600 mt-2 font-bold">Este script borra todos los vehículos corruptos y limpia el historial para que puedas cargar los nuevos sin errores.</p>}
                    {sqlTab === 'repair' && <p className="text-xs text-blue-600 mt-2 font-bold">Script V40: FIX READ PERMISSIONS. Desbloquea la lectura de perfiles para solucionar 'Database error finding user'.</p>}
                    {sqlTab === 'purge' && <p className="text-xs text-orange-600 mt-2 font-bold">⚠️ ELIMINA usuarios de Auth que no están en la lista visible. Úsalo para liberar emails bloqueados.</p>}
                    {sqlTab === 'forensic' && <p className="text-xs text-red-600 mt-2 font-bold">⚠️ ELIMINACIÓN QUIRÚRGICA V41: Soluciona el error 'Database error loading user' o 'User in use' forzando el borrado total.</p>}
                    {sqlTab === 'mass_purge' && <p className="text-xs text-indigo-600 mt-2 font-bold">⚠️ V42: Borra AUTOMÁTICAMENTE a todos los usuarios que no tienen perfil. Úsalo para limpiar usuarios 'rotos' masivamente.</p>}
              </div>
              <div className="bg-slate-50 px-4 py-4 sm:px-6 sm:flex sm:flex-row-reverse gap-3">
                <button type="button" onClick={handleCopySql} className="w-full inline-flex justify-center rounded-lg border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-bold text-white hover:bg-blue-700 sm:w-auto sm:text-sm">Copiar SQL</button>
                <button type="button" onClick={() => setShowSqlModal(false)} className="mt-3 w-full inline-flex justify-center rounded-lg border border-slate-300 shadow-sm px-4 py-2 bg-white text-base font-bold text-slate-700 hover:bg-slate-50 sm:mt-0 sm:w-auto sm:text-sm">Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {qrVehicle && (
          <div className="fixed z-50 inset-0 overflow-y-auto print:fixed print:inset-0 print:bg-white print:z-[100]">
             <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0 print:h-full print:p-0">
                 <div className="fixed inset-0 transition-opacity print:hidden" onClick={() => setQrVehicle(null)}><div className="absolute inset-0 bg-slate-900 opacity-80 backdrop-blur-sm"></div></div>
                 <div className="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md sm:w-full print:shadow-none print:w-full print:max-w-none print:h-full">
                     <div className="bg-white p-6 print:p-0 w-full flex flex-col items-center">
                         <div className="print:hidden w-full flex justify-between mb-4"><h3 className="text-xl font-bold text-slate-900">Tarjeta de Identificación</h3><button onClick={() => setQrVehicle(null)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button></div>
                         <QRCodeDisplay vehicleId={qrVehicle.id} vehicleName={qrVehicle.name} size={200} />
                     </div>
                     <div className="bg-slate-50 px-6 py-4 flex flex-row-reverse gap-3 print:hidden border-t border-slate-100">
                        <button onClick={() => window.print()} className="bg-slate-800 text-white px-4 py-2 rounded-lg font-medium hover:bg-slate-900">Imprimir</button>
                        <button onClick={handleDownloadQR} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700">Descargar PNG</button>
                     </div>
                 </div>
             </div>
          </div>
      )}
      
      {previewImage && (
          <div className="fixed z-[60] inset-0 bg-slate-900/95 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity" onClick={() => setPreviewImage(null)}>
              <div className="relative max-w-5xl w-full max-h-[90vh] flex flex-col items-center">
                  <button onClick={() => setPreviewImage(null)} className="absolute -top-12 right-0 text-white/80 hover:text-white text-xl font-bold flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full hover:bg-white/20 transition">
                      Cerrar <span>&times;</span>
                  </button>
                  <img 
                      src={previewImage} 
                      alt="Detalle de Vehículo" 
                      className="w-full h-full object-contain rounded-lg shadow-2xl"
                      onClick={(e) => e.stopPropagation()}
                  />
              </div>
          </div>
      )}
    </div>
  );
};
