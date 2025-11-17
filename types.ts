export enum UserRole {
  ADMIN = 'ADMIN',
  DRIVER = 'DRIVER',
  SUPERVISOR = 'SUPERVISOR'
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export enum VehicleStatus {
  AVAILABLE = 'AVAILABLE',
  IN_USE = 'IN_USE',
  MAINTENANCE = 'MAINTENANCE'
}

export interface Vehicle {
  id: string;
  name: string; // e.g. "Toyota Hilux 01"
  licensePlate: string;
  status: VehicleStatus;
  currentMileage: number;
  qrCodeUrl?: string; // Generated URL for the QR
  imageUrl?: string; // URL of the vehicle photo
  notes?: string;
}

export interface VehicleLog {
  id: string;
  vehicleId: string;
  driverId: string;
  driverName: string;
  startTime: string; // ISO Date
  endTime?: string; // ISO Date
  startMileage: number;
  endMileage?: number;
  notes?: string;
}

// Mock Data types for initialization
export interface MockDB {
  users: User[];
  vehicles: Vehicle[];
  logs: VehicleLog[];
}