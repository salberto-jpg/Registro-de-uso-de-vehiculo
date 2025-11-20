import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Cargar variables de entorno basadas en el modo actual (development, production)
  // El tercer argumento '' permite cargar todas las variables, no solo las que empiezan por VITE_
  const env = loadEnv(mode, (process as any).cwd(), '');

  return {
    plugins: [react()],
    define: {
      // Hacemos un polyfill manual de process.env para que el código existente funcione en el navegador
      // Esto inyecta los valores de Vercel en el bundle final
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
      'process.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL),
      'process.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY),
      // Prevenir crasheos si se accede a otras propiedades de process.env
      'process.env': JSON.stringify({})
    },
    build: {
      outDir: 'dist',
      sourcemap: false
    }
  };
});