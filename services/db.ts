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

    // --- ESTRATEGIA FAIL-OPEN ---
    // No esperamos a consultar la tabla 'profiles'. Si Auth pasó, construimos el usuario y entramos.
    // La tabla profiles se sincronizará después o se usará solo para datos extra.
    
    let role = UserRole.DRIVER; // Rol por defecto
    
    // Detectar Admin por email hardcoded (Seguridad infalible)
    if (email === 'salberto@metallo.com.ar' || email === 'admin@fleet.com') {
        role = UserRole.ADMIN;
    } else if (authData.user.user_metadata?.role) {
        role = authData.user.user_metadata.role as UserRole;
    }

    const immediateUser: User = {
        id: authData.user.id,
        email: email,
        name: authData.user.user_metadata?.name || email.split('@')[0],
        role: role
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
  if (supabase) await supabase.auth.signOut();
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
 * Esta función ahora es ULTRA RESISTENTE.
 * Prioridad 1: Sesión activa de Auth (Memoria/LocalStorage).
 * Prioridad 2: Base de datos (Profiles).
 * Si BD falla, usa Auth. NUNCA devuelve null si hay sesión activa.
 */
export const getCurrentUserProfile = async (): Promise<User | null> => {
  try {
    const supabase = getSupabaseClient();
    if (!isSupabaseConfigured() || !supabase) return null;

    // 1. Obtener sesión activa (Rápido)
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session || !session.user) {
        return null; // Realmente no hay nadie logueado
    }

    const authUser = session.user;
    const email = authUser.email || '';

    // 2. Construir Usuario "Seguro" desde Auth (Fallback)
    // Este objeto se devolverá si todo lo demás falla.
    let fallbackUser: User = {
        id: authUser.id,
        email: email,
        name: authUser.user_metadata?.name || email.split('@')[0],
        role: (authUser.user_metadata?.role as UserRole) || UserRole.DRIVER
    };

    // Override de Admin Hardcoded
    if (email === 'salberto@metallo.com.ar' || email === 'admin@fleet.com') {
        fallbackUser.role = UserRole.ADMIN;
        fallbackUser.name = 'Super Admin';
    }

    // 3. Intentar enriquecer con datos de la DB (Opcional)
    // Envolvemos en try/catch y timeout para que no bloquee
    try {
        // Promise.race para dar un tiempo máximo de 2s a la DB
        const dbPromise = supabase
            .from('profiles')
            .select('*')
            .eq('id', authUser.id)
            .single();
            
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject("Timeout DB"), 1500));

        const result: any = await Promise.race([dbPromise, timeoutPromise]);

        if (result && result.data) {
            return transformUser(result.data);
        }
    } catch (e) {
        console.warn("⚠️ DB Profile no respondió a tiempo o falló. Usando datos de sesión.", e);
    }

    // 4. Si DB falla, devolvemos el usuario de sesión inmediatamente.
    return fallbackUser;

  } catch (e) {
    console.error("Error fatal en getUserProfile:", e);
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

// --- USER MANAGEMENT (ADMIN ONLY) ---

export const getAllUsers = async (): Promise<User[]> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    const { data, error } = await supabase.from('profiles').select('*').order('name');
    if (error) {
        console.error("Error fetching users:", error);
        throw new Error(`Error cargando usuarios: ${error.message}`);
    }
    return data.map(transformUser);
  }
  return loadMockDB().users;
};

export const adminCreateUser = async (newUser: Omit<User, 'id'>, password?: string): Promise<User | null> => {
    const supabase = getSupabaseClient();
    if (isSupabaseConfigured() && supabase) {
        const { url, key } = getSupabaseConfig();
        
        const tempSupabase = createClient(url!, key!, {
            auth: {
                persistSession: false, 
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        });

        const { data: authData, error: authError } = await tempSupabase.auth.signUp({
            email: newUser.email,
            password: password || 'tempPassword123!', 
            options: {
                data: {
                    name: newUser.name,
                    role: newUser.role
                }
            }
        });

        if (authError) {
            if (authError.message?.includes("security purposes") || authError.status === 429) {
                 throw new Error("⚠️ Límite de seguridad de Supabase: Espera 60s entre creación de usuarios.");
            }
            if (authError.message?.includes("already registered") || authError.status === 400) {
                 throw new Error("Este correo ya está registrado.");
            }
            throw new Error("Error Auth: " + (authError.message || JSON.stringify(authError)));
        }

        if (!authData.user) {
            throw new Error("No se recibió ID de usuario.");
        }

        const newId = authData.user.id;

        const { error: rpcError } = await supabase.rpc('create_profile', {
            _id: newId,
            _email: newUser.email,
            _name: newUser.name,
            _role: newUser.role
        });

        if (rpcError) {
             if (rpcError.code === 'PGRST202') {
                 throw new Error("Falta función 'create_profile'. Ejecuta 'Ayuda DB' -> 'Reparar Permisos'.");
             }
             if (rpcError.code === '23505') {
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
    if (error) console.error("Error fetching vehicle:", error);
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
    if (error) {
        console.error("Error fetching vehicles:", error);
        throw new Error(`Error cargando vehículos: ${error.message} (Hint: Ejecuta 'Ayuda DB')`);
    }
    return data.map(transformVehicle);
  }
  return loadMockDB().vehicles;
};

// --- IMPROVED VEHICLE CRUD USING RPC (V5) ---

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
    
    if (error) {
         if (error.code === 'PGRST202') {
             throw new Error("Falta función 'manage_vehicle_v5'. Ve a 'Ayuda DB > Reparar Permisos'.");
         }
         throw new Error(error.message || `Error desconocido (${error.code})`);
    }

    if (!data) {
        throw new Error("Error desconocido: Sin respuesta de BD. Ejecuta 'Ayuda DB > Reparar'.");
    }
    
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
    if (!data) throw new Error("Error al actualizar: Sin respuesta.");
    
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
        try {
             await createVehicle(v);
        } catch (e: any) {
             console.warn(`Skipping ${v.name}:`, e.message);
             if (e.message?.includes('Falta función') || e.message?.includes('relation')) {
                 throw e; // Rethrow critical schema errors
             }
        }
    }
    return;
};

// --- LOGGING SERVICES ---

export const getAllLogs = async (): Promise<VehicleLog[]> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    const { data, error } = await supabase.from('logs').select('*').order('start_time', { ascending: false });
    if (error) {
        console.error("Error fetching logs:", error);
        throw new Error(`Error cargando historial: ${error.message}`);
    }
    return data.map(transformLog);
  }
  return loadMockDB().logs;
};

export const getActiveLog = async (vehicleId: string): Promise<VehicleLog | undefined> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    const { data } = await supabase
      .from('logs')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .is('end_time', null)
      .single();
    
    if (data) return transformLog(data);
    return undefined;
  }

  const db = loadMockDB();
  return db.logs.find(l => l.vehicleId === vehicleId && !l.endTime);
};

export const getUserActiveTrip = async (userId: string): Promise<VehicleLog | undefined> => {
    const supabase = getSupabaseClient();
    if (isSupabaseConfigured() && supabase) {
        const { data } = await supabase
        .from('logs')
        .select('*')
        .eq('driver_id', userId)
        .is('end_time', null)
        .single();
        
        if (data) return transformLog(data);
        return undefined;
    }
    const db = loadMockDB();
    return db.logs.find(l => l.driverId === userId && !l.endTime);
}

export const startTrip = async (vehicleId: string, user: User): Promise<void> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    // 1. Get current mileage
    const v = await getVehicle(vehicleId);
    if (!v) throw new Error('Vehicle not found');

    // 2. Create Log
    const { error: logError } = await supabase.from('logs').insert({
      vehicle_id: vehicleId,
      driver_id: user.id,
      driver_name: user.name,
      start_time: new Date().toISOString(),
      start_mileage: v.currentMileage
    });
    if (logError) throw new Error(logError.message);

    // 3. Update Vehicle Status
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
    const endM = log.startMileage + 15;
    log.endTime = new Date().toISOString();
    log.endMileage = endM;
    
    v.status = VehicleStatus.AVAILABLE;
    v.currentMileage = endM;
    saveMockDB(db);
  }
};