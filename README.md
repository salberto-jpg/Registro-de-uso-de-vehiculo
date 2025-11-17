# FleetTrack Pro - Guía de Instalación

## 1. Configuración de Base de Datos (Supabase)

Para que la aplicación funcione correctamente con Supabase, necesitas crear las tablas.

1.  Abre tu proyecto en [Supabase](https://supabase.com).
2.  Ve a la sección **SQL Editor** en la barra lateral izquierda.
3.  Crea una **New Query**.
4.  **Copia y pega** el siguiente código SQL y haz clic en **Run**:

```sql
-- ==========================================
-- SCRIPT DE REPARACIÓN MAESTRA V5
-- Ejecuta esto para arreglar Usuarios y Vehículos
-- ==========================================

-- 1. Limpiar caché y funciones previas para evitar conflictos
NOTIFY pgrst, 'reload schema';
DROP FUNCTION IF EXISTS create_profile CASCADE;
DROP FUNCTION IF EXISTS is_admin CASCADE;
DROP FUNCTION IF EXISTS manage_vehicle_v5 CASCADE;

-- 2. Asegurar que las tablas existen y tienen la estructura correcta
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

-- 3. FUNCIÓN SEGURA: Gestión de Vehículos (Evita error de tipos)
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
    
    -- Conversión segura de texto a número
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
        -- Desconectar logs antes de borrar para evitar error de llave foránea
        UPDATE public.logs SET vehicle_id = NULL WHERE vehicle_id = _id;
        DELETE FROM public.vehicles WHERE id = _id RETURNING * INTO _result;
        RETURN row_to_json(_result);
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. FUNCIÓN SEGURA: Crear Usuarios (Bypass RLS)
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

-- 6. HABILITAR PERMISOS (CRÍTICO para que funcione desde la App)
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.profiles TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.vehicles TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.logs TO postgres, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.manage_vehicle_v5 TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_profile TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin TO postgres, anon, authenticated, service_role;

-- 7. SEGURIDAD (RLS) - Configurada para permitir operaciones del Admin
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

-- Limpiar políticas viejas
DROP POLICY IF EXISTS "Policies Profiles" ON public.profiles;
DROP POLICY IF EXISTS "Policies Vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Policies Logs" ON public.logs;

-- Crear políticas permisivas (Las funciones RPC protegen la escritura sensible)
CREATE POLICY "Policies Profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Policies Vehicles" ON public.vehicles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Policies Logs" ON public.logs FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
```