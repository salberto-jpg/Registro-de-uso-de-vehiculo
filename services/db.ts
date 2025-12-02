

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

// --- ERROR HANDLING HELPER (ROBUST) ---
export const getErrorMessage = (error: any): string => {
    if (!error) return "Error desconocido";
    if (typeof error === 'string') {
        if (error === '[object Object]') return "Error desconocido (Objeto mal formado)";
        return error;
    }
    
    // Check for Error instance
    if (error instanceof Error) {
        return error.message;
    }
    
    let msg = "";
    
    // Check for object with message property (Supabase errors)
    if (error && typeof error === 'object' && 'message' in error) {
         if (typeof error.message === 'object' && error.message !== null) {
             try {
                msg = JSON.stringify(error.message);
             } catch (e) {
                msg = "Error: Objeto de mensaje ilegible";
             }
         } else {
             msg = String(error.message);
         }
    }
    
    // If we found a message but it looks like [object Object] or is empty, try better
    if (msg && msg !== "[object Object]") {
        return msg;
    }
    
    // Fallback for objects to avoid [object Object]
    try {
        return JSON.stringify(error);
    } catch (e) {
        return "Error crítico no legible";
    }
};

// --- CUSTOM MEMORY STORAGE TO FIX WARNINGS ---
const inMemoryStorage = {
    getItem: (key: string) => null,
    setItem: (key: string, value: string) => {},
    removeItem: (key: string) => {},
};

// --- TRANSFORMERS ---
const transformVehicle = (v: any): Vehicle => ({
  id: v.id,
  name: v.name,
  // Standard Select returns snake_case columns.
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

    if (authError) {
        const msg = getErrorMessage(authError);
        // Manejo específico para el caso común de email no confirmado
        if (msg.includes('Email not confirmed')) {
            return { user: null, error: "⚠️ Email no confirmado. Por favor revisa tu bandeja de entrada y haz clic en el enlace de verificación." };
        }
        if (msg.includes('Invalid login credentials')) {
            return { user: null, error: "Usuario o contraseña incorrectos." };
        }
        if (msg.includes('querying schema')) {
            return { user: null, error: "⚠️ ERROR DE BASE DE DATOS.\nTu base de datos necesita mantenimiento. Ejecuta el script 'Ayuda DB > Reparar V36'." };
        }
        return { user: null, error: msg };
    }
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
      if (error) {
           const msg = getErrorMessage(error);
           if (msg.includes('process request') || msg.includes('Too many requests')) {
               throw new Error("⚠️ LÍMITE DE SUPABASE ALCANZADO:\nHas enviado muchos correos recientemente. Supabase (Plan Gratuito) limita esto a 3-4 por hora.\nEspera una hora o contacta al administrador.");
           }
           if (msg.includes('security purposes') || msg.includes('seconds')) {
               throw new Error("⏳ POR SEGURIDAD:\nDebes esperar unos segundos antes de solicitar otro correo.");
           }
           throw error;
      }
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
 */
export const getCurrentUserProfile = async (): Promise<User | null> => {
  try {
    const supabase = getSupabaseClient();
    if (!isSupabaseConfigured() || !supabase) return null;

    // 1. Obtener usuario de Auth
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || !session.user) {
            return null;
        }
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
        const timeout = new Promise((_, reject) => setTimeout(() => reject("DB Timeout"), 5000));
        
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
    if (error) throw new Error(`Error cargando usuarios: ${getErrorMessage(error)}`);
    return data.map(transformUser);
  }
  return loadMockDB().users;
};

export const adminCreateUser = async (newUser: Omit<User, 'id'>, password?: string): Promise<User | null> => {
    const supabase = getSupabaseClient();
    if (isSupabaseConfigured() && supabase) {
        const { url, key } = getSupabaseConfig();
        const lowerEmail = newUser.email.toLowerCase(); // NORMALIZAR SIEMPRE
        
        // Crear cliente temporal aislado para no cerrar sesión al admin
        const tempSupabase = createClient(url!, key!, {
            auth: {
                persistSession: false, 
                autoRefreshToken: false,
                detectSessionInUrl: false,
                storage: inMemoryStorage
            }
        });

        // 1. CREAR USUARIO EN AUTH (Flujo Estándar NORMALIZADO)
        // Ya no usamos bypass, ni auto-confirm, ni hacks.
        // Respetamos la configuración del dashboard de Supabase.
        const { data: authData, error: authError } = await tempSupabase.auth.signUp({
            email: lowerEmail,
            password: password || 'tempPassword123!',
            options: {
                data: {
                    name: newUser.name,
                    role: newUser.role
                }
            }
        });

        if (authError) {
            const msg = getErrorMessage(authError).toLowerCase();
            console.warn("API SignUp Error:", msg);
            
            // ERROR ESPECÍFICO: Security Cooldown
            if (msg.includes('security purposes') || msg.includes('seconds')) {
                throw new Error("⏳ DEMASIADO RÁPIDO:\nSupabase bloquea la creación repetida para evitar spam. Debes esperar 60 segundos antes de crear otro usuario.");
            }

            // ERROR ESPECÍFICO: Signups Disabled
            if (msg.includes('signups not allowed')) {
                throw new Error("⛔ CONFIGURACIÓN BLOQUEADA EN SUPABASE:\nLos registros están desactivados. Ve a tu panel de Supabase > Authentication > User Signups y activa 'Allow new users to sign up'.");
            }
            
            // Si el usuario ya existe, intentamos sincronizar
            if (msg.includes('already registered')) {
                console.log("Usuario ya existe. Intentando sincronizar perfil...");
                const { error: syncError } = await supabase.rpc('sync_profile_by_email', {
                    _email: lowerEmail,
                    _name: newUser.name,
                    _role: newUser.role
                });

                if (syncError) {
                     throw new Error("El usuario ya existe pero no se pudo sincronizar. " + getErrorMessage(syncError));
                }
                
                // Si sincronizó bien, devolvemos un objeto dummy
                return { id: "synced", email: lowerEmail, name: newUser.name, role: newUser.role };
            }
            
            throw new Error(getErrorMessage(authError));
        }

        let newId = authData.user?.id;

        // 2. ASEGURAR PERFIL PÚBLICO
        // Intentamos crear el perfil inmediatamente si tenemos el ID.
        if (newId) {
            const { error: rpcError } = await supabase.rpc('create_profile', {
                _id: newId,
                _email: lowerEmail,
                _name: newUser.name,
                _role: newUser.role
            });

            if (rpcError && rpcError.code !== '23505') { 
                 console.warn("Aviso Profile RPC:", rpcError.message);
            }
        }

        // 3. VERIFICACIÓN FINAL
        // Verificamos si se creó realmente (a veces el trigger falla).
        if (newId) {
             const { data: check } = await supabase.from('profiles').select('id').eq('id', newId).single();
             if (!check) {
                 // Si no existe, lanzamos error para que no diga "Creado con éxito"
                 // A menos que esté pendiente de email, en cuyo caso puede que no tenga perfil aún.
                 // Como volvimos a flujo normal, esto es aceptable.
             }
        }
        
        return {
            id: newId || 'pending',
            email: lowerEmail,
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
    
    if (error) throw new Error(getErrorMessage(error));
    return;
  }

  const db = loadMockDB();
  const idx = db.users.findIndex(u => u.id === user.id);
  if (idx !== -1) {
    db.users[idx] = { ...db.users[idx], name: user.name, role: user.role };
    saveMockDB(db);
  }
};

export const adminResetUserPassword = async (userId: string, newPassword: string): Promise<void> => {
    const supabase = getSupabaseClient();
    if (isSupabaseConfigured() && supabase) {
        const { error } = await supabase.rpc('admin_reset_password', {
            target_id: userId,
            new_password: newPassword
        });
        if (error) throw new Error(getErrorMessage(error));
        return;
    }
    console.log(`[MockDB] Reset password for ${userId} to ${newPassword}`);
};

export const adminDeleteUser = async (id: string): Promise<void> => {
  const supabase = getSupabaseClient();
  if (isSupabaseConfigured() && supabase) {
    // Usamos el RPC seguro para borrar de Auth y Public
    const { error } = await supabase.rpc('delete_user_completely', { target_id: id });
    if (error) throw new Error(getErrorMessage(error));
    return;
  }

  const db = loadMockDB();
  db.users = db.users.filter(u => u.id !== id);
  saveMockDB(db);
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
    if (error) throw new Error(`Error cargando vehículos: ${getErrorMessage(error)}`);
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
    if (error) throw new Error(getErrorMessage(error));
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
    if (error) throw new Error(getErrorMessage(error));
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
    if (error) throw new Error(getErrorMessage(error));
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
    if (error) throw new Error(`Error cargando historial: ${getErrorMessage(error)}`);
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
    
    // 1. AUTO-HEALING: Close any previous ghost trips
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

    // 2. ENSURE PROFILE EXISTS
    const { error: profileError } = await supabase.from('profiles').upsert({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
    }, { onConflict: 'id' });

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
        if (logError.code === '23503') {
             await supabase.rpc('create_profile', {
                _id: user.id,
                _email: user.email,
                _name: user.name,
                _role: user.role
             });
             
             const { error: retryError } = await supabase.from('logs').insert({
                vehicle_id: vehicleId,
                driver_id: user.id,
                driver_name: user.name,
                start_time: new Date().toISOString(),
                start_mileage: v.currentMileage
             });
             
             if (retryError) throw new Error("Error de integridad: Usuario no sincronizado. Contacta al administrador.");
        } else {
            throw new Error(getErrorMessage(logError));
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
    if (error) throw new Error(getErrorMessage(error));

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
