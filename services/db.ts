
import { Vehicle, VehicleLog, User, UserRole, VehicleStatus, MockDB } from '../types';
import { getSupabaseClient, isSupabaseConfigured, getSupabaseConfig } from './supabase';
import { createClient } from '@supabase/supabase-js';

// --- MOCK DATA HELPERS (Fallback) ---
const STORAGE_KEY = 'fleet_track_db_v5'; 

const INITIAL_DB: MockDB = {
  users: [
    { id: 'u1', email: 'salberto@metallo.com.ar', name: 'Salberto Admin', role: UserRole.ADMIN },
    { id: 'u2', email: 'driver@fleet.com', name: 'Juan Pérez', role: UserRole.DRIVER },
  ],
  vehicles: [
    { id: 'v1', name: 'Nissan Frontier', licensePlate: 'ABC-123', status: VehicleStatus.AVAILABLE, currentMileage: 45000 },
  ],
  logs: []
};

const loadMockDB = (): MockDB => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_DB));
    return INITIAL_DB;
  }
  return JSON.parse(stored);
};

const saveMockDB = (db: MockDB) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
};

// --- UTILS ---
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// --- TRANSFORMERS ---
const transformVehicle = (v: any): Vehicle => ({
  id: v.id,
  name: v.name,
  licensePlate: v.license_plate,
  status: v.status as VehicleStatus,
  currentMileage: v.current_mileage,
  qrCodeUrl: v.qr_code_url,
  imageUrl: v.image_url,
  notes: v.notes
});

const transformLog = (l: any): VehicleLog => ({
  id: l.id,
  vehicleId: l.vehicle_id,
  driverId: l.driver_id,
  driverName: l.driver_name,
  startTime: l.start_time,
  endTime: l.end_time,
  startMileage: l.start_mileage,
  endMileage: l.end_mileage,
  notes: l.notes
});

const transformUser = (u: any): User => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as UserRole
});

// --- AUTHENTICATION SERVICES ---

export const signInWithEmail = async (email: string, password: string): Promise<{ user: User | null, error?: string }> => {
  
  // --- DEV BACKDOOR ---
  if ((email === 'salberto@metallo.com.ar' || email === 'admin@fleet.com') && password === 'admin') {
      return { 
          user: { 
              id: 'dev-admin-id', 
              email: email, 
              name: 'Admin (Modo Desarrollador)', 
              role: UserRole.ADMIN 
          } 
      };
  }

  const supabase = getSupabaseClient();
  
  if (isSupabaseConfigured() && supabase) {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) return { user: null, error: authError.message };
    if (!authData.user) return { user: null, error: 'No se pudo obtener el usuario.' };

    const immediateUser: User = {
        id: authData.user.id,
        email: email,
        name: authData.user.user_metadata?.name || email.split('@')[0],
        role: (authData.user.user_metadata?.role as UserRole) || UserRole.DRIVER
    };

    return { user: immediateUser };
  }

  const db = loadMockDB();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (user) return { user };
  return { user: null, error: 'Usuario no encontrado (Mock)' };
};

export const signOut = async () => {
  const supabase = getSupabaseClient();
  if (supabase) {
      await supabase.auth.signOut();
  }
  localStorage.removeItem('sb-fleet-auth-token'); // Clean manually if custom
};

export const resetPassword = async (email: string) => {
  const supabase = getSupabaseClient();
  if (supabase) {
      const redirectTo = window.location.origin; 
      const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: redirectTo
      });
      return { data, error, redirectTo };
  }
  return { data: null, error: null, redirectTo: null }; 
};

export const updateUserPassword = async (password: string) => {
    const supabase = getSupabaseClient();
    if (supabase) {
        return supabase.auth.updateUser({ password });
    }
    throw new Error("Supabase no configurado");
};

/**
 * OBTIENE EL PERFIL ACTUAL DE FORMA ULTRA SEGURA
 * - Usa Promise.race para evitar bloqueos.
 * - Falla a null si hay errores, permitiendo al usuario loguearse de nuevo.
 */
export const getCurrentUserProfile = async (): Promise<User | null> => {
  try {
    const supabase = getSupabaseClient();
    if (!isSupabaseConfigured() || !supabase) return null;

    // 1. Obtener usuario de Auth (Intenta getUser, si falla, usa getSession para velocidad)
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        // Si getUser falla, intentamos session por si es un problema de red puntual
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || !session.user) {
            return null;
        }
        // Usamos session user como fallback
        const sUser = session.user;
        const email = sUser.email || '';
        return {
             id: sUser.id,
             email: email,
             name: sUser.user_metadata?.name || email.split('@')[0],
             role: (sUser.user_metadata?.role as UserRole) || UserRole.DRIVER
        };
    }

    // 2. Si tenemos usuario, intentamos buscar su perfil
    const email = user.email || '';
    
    try {
        // Timeout para la BD: si tarda más de 2s, usamos datos de metadata
        const timeout = new Promise((_, reject) => setTimeout(() => reject("DB Timeout"), 2000));
        
        const dbPromise = supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();
            
        const result: any = await Promise.race([dbPromise, timeout]);
        
        if (result && result.data && !result.error) {
            return transformUser(result.data);
        }
    } catch (e) {
        console.warn("No se pudo cargar perfil de DB, usando metadata:", e);
    }

    // 3. Fallback final: Usar metadata del token
    let fallbackRole = (user.user_metadata?.role as UserRole) || UserRole.DRIVER;
    
    // Hardcode de seguridad para el dueño
    if (email === 'salberto@metallo.com.ar' || email === 'admin@fleet.com') {
        fallbackRole = UserRole.ADMIN;
    }

    return {
        id: user.id,
        email: email,
        name: user.user_metadata?.name || email.split('@')[0],
        role: fallbackRole
    };

  } catch (e) {
    console.error("Error fatal en getCurrentUserProfile:", e);
    return null;
  }
};

export const subscribeToAuthChanges = (callback: (event: string, session: any) => void) => {
  const supabase = getSupabaseClient();
  if (supabase) {
    return supabase.auth.onAuthStateChange(callback);
  }
  return { data: { subscription: { unsubscribe: () => {} } } };
};

// --- USER MANAGEMENT ---

export const getAllUsers = async (): Promise<User[]> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    const { data, error } = await supabase.from('profiles').select('*').order('name');
    if (error) throw new Error(`Error cargando usuarios: ${error.message}`);
    return data.map(transformUser);
  }
  return loadMockDB().users;
};

export const adminCreateUser = async (newUser: Omit<User, 'id'>, password?: string): Promise<User | null> => {
    const supabase = getSupabaseClient();
    if (isSupabaseConfigured() && supabase) {
        const { url, key } = getSupabaseConfig();
        
        // Crear cliente temporal para no cerrar la sesión del admin
        const tempSupabase = createClient(url!, key!, {
            auth: {
                persistSession: false, 
                autoRefreshToken: false,
                detectSessionInUrl: false,
                storageKey: 'temp_admin_worker' // Fix for Multiple GoTrueClient warning
            }
        });

        let newId = "";

        // 1. INTENTAR CREAR USUARIO EN AUTH
        const { data: authData, error: authError } = await tempSupabase.auth.signUp({
            email: newUser.email,
            password: password || 'tempPassword123!',
            options: {
                emailRedirectTo: 'https://registro-de-uso-de-vehiculo.vercel.app/',
                data: {
                    name: newUser.name,
                    role: newUser.role
                }
            }
        });

        if (authError) {
            const msg = authError.message.toLowerCase();
            
            // A) Rate Limit Error - Traducir y detener
            if (msg.includes('security purposes') || msg.includes('seconds')) {
                 throw new Error("Por seguridad, espera unos segundos antes de volver a intentar crear el usuario.");
            }

            // B) Database Error - Problema de Trigger
            if (msg.includes('database error')) {
                 throw new Error("Conflicto en Base de Datos. Ejecuta el script de 'Reparar Permisos' en el menú de ayuda.");
            }

            // C) Usuario ya registrado - Intentar recuperación (Idempotencia)
            if (msg.includes('already registered') || authError.status === 422) {
                // Si ya existe, necesitamos el ID. No podemos obtenerlo directamente sin loguearnos como él,
                // pero podemos intentar crear el perfil asumiendo que el ID lo resolverá el admin después
                // o simplemente fallar más amigablemente.
                console.warn("Usuario ya existe en Auth, intentando recrear perfil...");
                // En este caso, no tenemos el ID nuevo. Es un problema.
                throw new Error("El usuario ya está registrado. Si no aparece en la lista, ejecuta 'Ayuda DB > Reparar Permisos' y crea el usuario de nuevo.");
            }
            
            throw new Error("Error Auth: " + authError.message);
        }

        if (authData.user) {
            newId = authData.user.id;
        } else {
            throw new Error("No se recibió ID de usuario.");
        }

        // 2. CREAR O ACTUALIZAR PERFIL PUBLICO
        const { error: rpcError } = await supabase.rpc('create_profile', {
            _id: newId,
            _email: newUser.email,
            _name: newUser.name,
            _role: newUser.role
        });

        if (rpcError) {
             if (rpcError.code === '23505') { // Duplicate key
                 return { id: newId, email: newUser.email, name: newUser.name, role: newUser.role };
             }
             throw new Error("Error Profile: " + rpcError.message);
        }

        return {
            id: newId,
            email: newUser.email,
            name: newUser.name,
            role: newUser.role
        };
    }
    
    const db = loadMockDB();
    const u = { ...newUser, id: Math.random().toString(36).substr(2, 9) };
    db.users.push(u);
    saveMockDB(db);
    return u;
}

export const adminUpdateUser = async (user: User): Promise<void> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    const { error } = await supabase.from('profiles').update({
      name: user.name,
      role: user.role,
    }).eq('id', user.id);
    
    if (error) throw new Error(error.message);
    return;
  }

  const db = loadMockDB();
  const idx = db.users.findIndex(u => u.id === user.id);
  if (idx !== -1) {
    db.users[idx] = { ...db.users[idx], name: user.name, role: user.role };
    saveMockDB(db);
  }
};

// --- VEHICLE & LOGS ---

export const getVehicle = async (id: string): Promise<Vehicle | undefined> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    const { data, error } = await supabase.from('vehicles').select('*').eq('id', id).single();
    if (error || !data) return undefined;
    return transformVehicle(data);
  }
  const db = loadMockDB();
  return db.vehicles.find(v => v.id === id);
};

export const getAllVehicles = async (): Promise<Vehicle[]> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    const { data, error } = await supabase.from('vehicles').select('*').order('name');
    if (error) throw new Error(`Error cargando vehículos: ${error.message}`);
    return data.map(transformVehicle);
  }
  return loadMockDB().vehicles;
};

export const createVehicle = async (vehicle: Omit<Vehicle, 'id'>): Promise<Vehicle> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    const newId = vehicle.licensePlate.replace(/\s/g, '-').toLowerCase(); 
    
    const payload = {
         op: 'create',
         id: newId,
         name: vehicle.name,
         license_plate: vehicle.licensePlate,
         status: vehicle.status,
         mileage: vehicle.currentMileage,
         image_url: vehicle.imageUrl,
         notes: vehicle.notes
    };

    const { data, error } = await supabase.rpc('manage_vehicle_v5', { payload });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Sin respuesta de BD.");
    
    return transformVehicle(data);
  }

  const db = loadMockDB();
  const v = { ...vehicle, id: vehicle.licensePlate.replace(/\s/g, '-').toLowerCase() };
  db.vehicles.push(v);
  saveMockDB(db);
  return v;
};

export const updateVehicle = async (vehicle: Vehicle): Promise<void> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    const payload = {
         op: 'update',
         id: vehicle.id,
         name: vehicle.name,
         license_plate: vehicle.licensePlate,
         status: vehicle.status,
         mileage: vehicle.currentMileage,
         image_url: vehicle.imageUrl,
         notes: vehicle.notes
    };

    const { data, error } = await supabase.rpc('manage_vehicle_v5', { payload });
    if (error) throw new Error(error.message);
    return;
  }

  const db = loadMockDB();
  const idx = db.vehicles.findIndex(v => v.id === vehicle.id);
  if (idx !== -1) {
    db.vehicles[idx] = vehicle;
    saveMockDB(db);
  }
};

export const deleteVehicle = async (id: string): Promise<void> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    const payload = { op: 'delete', id: id };
    const { error } = await supabase.rpc('manage_vehicle_v5', { payload });
    if (error) throw new Error(error.message);
    return;
  }

  const db = loadMockDB();
  db.vehicles = db.vehicles.filter(v => v.id !== id);
  saveMockDB(db);
};

export const seedDatabase = async (): Promise<void> => {
    const supabase = getSupabaseClient();
    if (!isSupabaseConfigured() || !supabase) throw new Error("Supabase no conectado");

    const vehiclesToCreate = [
        { name: 'Toyota Hilux', licensePlate: 'AA-123-BB', currentMileage: 50000, status: VehicleStatus.AVAILABLE },
        { name: 'Ford Ranger', licensePlate: 'CC-987-DD', currentMileage: 12000, status: VehicleStatus.AVAILABLE },
        { name: 'Nissan Frontier', licensePlate: 'ZZ-555-XX', currentMileage: 85400, status: VehicleStatus.AVAILABLE }
    ];

    for (const v of vehiclesToCreate) {
        try { await createVehicle(v); } catch (e) { console.warn(e); }
    }
    return;
};

// --- LOGGING SERVICES ---

export const getAllLogs = async (): Promise<VehicleLog[]> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    const { data, error } = await supabase.from('logs').select('*').order('start_time', { ascending: false });
    if (error) throw new Error(`Error cargando historial: ${error.message}`);
    return data.map(transformLog);
  }
  return loadMockDB().logs;
};

export const getActiveLog = async (vehicleId: string): Promise<VehicleLog | undefined> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    const { data } = await supabase.from('logs').select('*').eq('vehicle_id', vehicleId).is('end_time', null).limit(1).maybeSingle();
    if (data) return transformLog(data);
    return undefined;
  }
  const db = loadMockDB();
  return db.logs.find(l => l.vehicleId === vehicleId && !l.endTime);
};

export const getUserActiveTrip = async (userId: string): Promise<VehicleLog | undefined> => {
    const supabase = getSupabaseClient();
    if (isSupabaseConfigured() && supabase) {
        const { data } = await supabase.from('logs').select('*').eq('driver_id', userId).is('end_time', null).limit(1).maybeSingle();
        if (data) return transformLog(data);
        return undefined;
    }
    const db = loadMockDB();
    return db.logs.find(l => l.driverId === userId && !l.endTime);
}

export const startTrip = async (vehicleId: string, user: User): Promise<void> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    
    // 1. AUTO-HEALING: Close any previous ghost trips for this vehicle
    const ghostLog = await getActiveLog(vehicleId);
    if (ghostLog) {
        console.warn(`Cerrando viaje fantasma para vehículo ${vehicleId}`);
        await supabase.from('logs').update({
            end_time: new Date().toISOString(),
            notes: 'Cierre automático por nuevo inicio'
        }).eq('id', ghostLog.id);
    }

    const v = await getVehicle(vehicleId);
    if (!v) throw new Error('Vehicle not found');

    // 2. CRITICAL FIX: Ensure Profile Exists (Upsert) to avoid FK error
    // Even if user is logged in, profile table might be missing the row
    const { error: profileError } = await supabase.from('profiles').upsert({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
    }, { onConflict: 'id' });

    // If normal upsert fails (e.g. RLS), try RPC fallback
    if (profileError) {
         await supabase.rpc('create_profile', {
            _id: user.id,
            _email: user.email,
            _name: user.name,
            _role: user.role
         });
    }

    const { error: logError } = await supabase.from('logs').insert({
      vehicle_id: vehicleId,
      driver_id: user.id,
      driver_name: user.name,
      start_time: new Date().toISOString(),
      start_mileage: v.currentMileage
    });

    if (logError) {
        // Code 23503 is Foreign Key Violation
        if (logError.code === '23503') {
             // Last ditch effort: Force create via RPC again then retry log
             await supabase.rpc('create_profile', {
                _id: user.id,
                _email: user.email,
                _name: user.name,
                _role: user.role
             });
             
             // Retry insert
             const { error: retryError } = await supabase.from('logs').insert({
                vehicle_id: vehicleId,
                driver_id: user.id,
                driver_name: user.name,
                start_time: new Date().toISOString(),
                start_mileage: v.currentMileage
             });
             
             if (retryError) throw new Error("Error de integridad: Tu usuario no está sincronizado en la base de datos. Contacta al administrador.");
        } else {
            throw new Error(logError.message);
        }
    }

    const updatePayload = {
         op: 'update',
         id: v.id,
         name: v.name,
         license_plate: v.licensePlate,
         status: VehicleStatus.IN_USE,
         mileage: v.currentMileage,
         image_url: v.imageUrl,
         notes: v.notes
    };
    await supabase.rpc('manage_vehicle_v5', { payload: updatePayload });
    return;
  }

  const db = loadMockDB();
  const v = db.vehicles.find(veh => veh.id === vehicleId);
  if (v) {
    v.status = VehicleStatus.IN_USE;
    db.logs.unshift({
      id: generateUUID(),
      vehicleId,
      driverId: user.id,
      driverName: user.name,
      startTime: new Date().toISOString(),
      startMileage: v.currentMileage
    });
    saveMockDB(db);
  }
};

export const endTrip = async (vehicleId: string): Promise<void> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    const activeLog = await getActiveLog(vehicleId);
    if (!activeLog) throw new Error('No active trip found');
    const v = await getVehicle(vehicleId);
    if (!v) throw new Error('Vehicle not found');

    const endMileage = activeLog.startMileage + Math.floor(Math.random() * 50) + 1; 
    
    const { error } = await supabase.from('logs').update({
      end_time: new Date().toISOString(),
      end_mileage: endMileage
    }).eq('id', activeLog.id);
    if (error) throw new Error(error.message);

    const updatePayload = {
         op: 'update',
         id: v.id,
         name: v.name,
         license_plate: v.licensePlate,
         status: VehicleStatus.AVAILABLE,
         mileage: endMileage,
         image_url: v.imageUrl,
         notes: v.notes
    };
    await supabase.rpc('manage_vehicle_v5', { payload: updatePayload });
    return;
  }

  const db = loadMockDB();
  const log = db.logs.find(l => l.vehicleId === vehicleId && !l.endTime);
  const v = db.vehicles.find(veh => veh.id === vehicleId);
  if (log && v) {
    log.endTime = new Date().toISOString();
    log.endMileage = log.startMileage + 15;
    v.status = VehicleStatus.AVAILABLE;
    v.currentMileage = log.endMileage;
    saveMockDB(db);
  }
};
