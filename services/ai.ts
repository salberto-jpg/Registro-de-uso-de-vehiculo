
import { GoogleGenAI } from "@google/genai";
import { Vehicle, VehicleLog } from "../types";

export const generateFleetReport = async (vehicles: Vehicle[], logs: VehicleLog[]): Promise<string> => {
  let apiKey;
  try {
    // Access the API key safely
    apiKey = process.env.API_KEY;
  } catch (e) {
    // process is not defined
  }

  if (!apiKey) {
    return "Configuración incompleta: API_KEY no encontrada. Por favor configure la variable de entorno para usar IA.";
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    const dataContext = JSON.stringify({
      vehicles: vehicles.map(v => ({ name: v.name, mileage: v.currentMileage, status: v.status })),
      recentLogs: logs.slice(0, 10) // Analyze last 10 logs
    });

    const prompt = `
      Actúa como un gerente de flota experto. Analiza los siguientes datos de vehículos y registros recientes en formato JSON.
      Genera un reporte breve (máximo 2 párrafos) en español que incluya:
      1. Estado general de la flota.
      2. Alertas de mantenimiento basadas en el kilometraje (asume mantenimiento cada 10,000 km).
      3. Patrones de uso inusuales si los hay.
      
      Datos: ${dataContext}
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || "No se pudo generar el reporte.";
  } catch (error) {
    console.error("Error generating AI report:", error);
    return "Error al conectar con Gemini AI. Intente más tarde.";
  }
};
