import 'dotenv/config';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

// Valida y convierte las variables de entorno al iniciar para fallar pronto si falta configuración.
const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LDAP_URL: z.string().url().refine((value) => new URL(value).protocol === 'ldaps:', 'LDAP_URL debe usar ldaps://'),
  LDAP_BIND_DN: z.string().min(1),
  LDAP_BIND_PASSWORD: z.string().min(1),
  API_TOKEN: z.string().min(32),
  AUTH_SESSION_TTL_MS: z.coerce.number().int().positive().default(1_800_000),
  LDAP_BASE_DN: z.string().min(1),
  LDAP_USERS_OU: z.string().min(1),
  AUTH_GROUP_ADMIN_DN: z.string().optional().default(''),
  AUTH_GROUP_SUPERVISOR_DN: z.string().optional().default(''),
  AUTH_GROUP_USER_DN: z.string().optional().default(''),
  LDAP_CA_CERT_PATH: z.string().optional().default(''),
  HTTPS_CERT_PATH: z.string().optional().default(''),
  HTTPS_KEY_PATH: z.string().optional().default(''),
  LDAP_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  CORS_ORIGIN: z.string().optional().default('*')
}).superRefine((values, context) => {
  if (Boolean(values.HTTPS_CERT_PATH) !== Boolean(values.HTTPS_KEY_PATH)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['HTTPS_CERT_PATH'],
      message: 'HTTPS_CERT_PATH y HTTPS_KEY_PATH deben configurarse juntos'
    });
  }
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // No se imprime ningún valor recibido, ya que podría contener secretos.
  throw new Error(`Configuracion de entorno invalida: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
}

const env = parsed.data;
export const config = {
  ...env,
  // Si se indica una CA privada, Node la usa para verificar el certificado del controlador LDAP.
  ldapTlsOptions: env.LDAP_CA_CERT_PATH ? { ca: [readFileSync(env.LDAP_CA_CERT_PATH)] } : undefined,
  httpsOptions: env.HTTPS_CERT_PATH ? {
      cert: readFileSync(env.HTTPS_CERT_PATH),
      key: readFileSync(env.HTTPS_KEY_PATH)
    } : null
};

// Compara tokens en tiempo constante para reducir filtraciones por diferencias de tiempo.
export function isValidApiToken(candidate) {
  if (typeof candidate !== 'string') return false;
  const expected = Buffer.from(config.API_TOKEN);
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
}