import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Works from backend/src and backend/dist; deployment environment takes priority.
const envFile = resolve(__dirname, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
