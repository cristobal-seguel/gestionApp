# API de usuarios para Samba AD

API REST con Node.js, Express y LDAP para autenticar y administrar usuarios de Samba Active Directory. Usa LDAPS para consultar el directorio y validar las credenciales de cada usuario.

## Requisitos

- Node.js 20 o superior.
- Samba AD accesible desde el servidor de la API, preferentemente mediante LDAPS (TCP 636).
- Una cuenta de servicio delegada con permisos solo sobre la OU administrada: leer usuarios, crear, modificar atributos y eliminar usuarios. No usar una cuenta Domain Admin.

## Instalación y ejecución

```bash
npm install
cp .env.example .env
```

Edita `.env` con el FQDN, DN de la cuenta de servicio, DN de dominio y OU real. Si el certificado LDAPS está firmado por una CA privada, configura `LDAP_CA_CERT_PATH` con la ruta al certificado de esa CA. No desactives la validación TLS en producción.

Si una solicitud devuelve `unable to verify the first certificate`, el proceso Node no confía en la CA que firmó el certificado LDAPS o no puede leer el archivo configurado. Copia el certificado público de la CA (`ca.pem`) desde el controlador al servidor Node, configura `LDAP_CA_CERT_PATH` con su ruta absoluta real y reinicia el proceso para que vuelva a cargar `.env`. No copies la clave privada del controlador (`key.pem`). En el servidor Node puedes comprobar la cadena con:

```bash
openssl s_client -connect dc1.example.com:636 \\
  -servername dc1.example.com \\
  -CAfile /ruta/real/ca.pem \\
  -verify_return_error
```

La verificación debe terminar con `Verify return code: 0 (ok)`. Sustituye el nombre y la ruta por los de tu entorno. El nombre usado en `LDAP_URL` también debe corresponder al certificado del controlador.

```bash
npm run dev
```

La API queda en `http://localhost:3000`; `GET /health` comprueba que el proceso está activo, no que el controlador de dominio sea alcanzable. Para iniciar en modo normal, usa `npm start`. Ejecuta `npm test` para los tests HTTP aislados y `npm run check` para validar sintaxis.

## Configuración

| Variable | Descripción |
| --- | --- |
| `PORT` | Puerto HTTP/HTTPS (por defecto `3000`). |
| `LDAP_URL` | URL LDAPS (`ldaps://host:636`); el transporte cifrado es obligatorio. |
| `LDAP_BIND_DN` | DN de la cuenta de servicio. |
| `LDAP_BIND_PASSWORD` | Contraseña de la cuenta de servicio. Mantener fuera del control de versiones. |
| `API_TOKEN` | Secreto Bearer de al menos 32 caracteres para la API LDAP legacy `/api/users`. |
| `AUTH_SESSION_TTL_MS` | Duración de las sesiones en milisegundos (por defecto 1800000, 30 minutos). |
| `LDAP_BASE_DN` | DN base del dominio, por ejemplo `DC=empresa,DC=local`. |
| `LDAP_USERS_OU` | OU donde la API buscará y creará usuarios. |
| `AUTH_GROUP_ADMIN_DN` | DN del grupo de seguridad AD que concede el rol `Administrador`. |
| `AUTH_GROUP_SUPERVISOR_DN` | DN del grupo de seguridad AD que concede el rol `Supervisor`. |
| `AUTH_GROUP_USER_DN` | DN del grupo de seguridad AD que concede el rol `Usuario`. |
| `LDAP_CA_CERT_PATH` | Ruta opcional a certificado PEM de la CA que firma LDAPS. |
| `HTTPS_CERT_PATH` | Ruta opcional al certificado PEM del servidor web. Requerido junto con `HTTPS_KEY_PATH` para habilitar HTTPS. |
| `HTTPS_KEY_PATH` | Ruta opcional a la clave privada PEM del servidor web. Mantener fuera del repositorio. |
| `LDAP_TIMEOUT_MS` | Timeout de conexión y operaciones LDAP. |
| `CORS_ORIGIN` | Origen frontend permitido; en producción define el origen exacto. |

### HTTPS para navegador y backend

Por defecto, el proceso escucha por HTTP. Para habilitar HTTPS directamente en Node, crea un certificado cuyo SAN incluya el nombre DNS que usarán los clientes y configura las dos rutas anteriores en `backend/.env`. Para una prueba con `gestioapp.interno`:

```bash
sudo install -d -m 700 /etc/gestionapp/tls
sudo openssl req -x509 -newkey rsa:3072 -sha256 -days 365 -nodes \
  -keyout /etc/gestionapp/tls/privkey.pem \
  -out /etc/gestionapp/tls/cert.pem \
  -subj "/CN=gestioapp.interno" \
  -addext "subjectAltName=DNS:gestioapp.interno"
sudo chmod 600 /etc/gestionapp/tls/privkey.pem
```

Configura `HTTPS_CERT_PATH=/etc/gestionapp/tls/cert.pem` y `HTTPS_KEY_PATH=/etc/gestionapp/tls/privkey.pem`. Ambos valores deben estar definidos juntos. Haz que `gestioapp.interno` resuelva a la IP del servidor mediante DNS interno o, solo para pruebas, el archivo `hosts` de cada cliente. Reinicia Node y abre `https://gestioapp.interno:3000/app.html#/login`. Al ser mismo origen, el frontend mantiene `baseUrl: /api/v1`.

El certificado autofirmado debe instalarse como confiable en los navegadores/equipos cliente; de lo contrario, aparecerá una advertencia TLS. No uses `-k` ni omitas la validación del certificado en el navegador para producción. En despliegues reales es preferible un certificado de la CA corporativa o terminar TLS en un proxy inverso. Si no configuras las dos variables, el servidor sigue usando HTTP.

## Endpoints

Las rutas de usuario versionadas usan un token de sesión emitido por `/api/v1/auth/login`. Las rutas legacy `/api/users` requieren `Authorization: Bearer <API_TOKEN>`. Los campos retornados nunca incluyen contraseñas ni atributos de credenciales.

### Contrato compatible con GestioApp

El frontend define `CONFIG.api.baseUrl` como `/api/v1` y espera estas rutas:

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/api/v1/auth/login` | Autentica `email` y `password` contra Samba AD; devuelve `{ token, user }`. No requiere token previo. |
| `POST` | `/api/v1/auth/logout` | Revoca el token de sesión y responde `204`. |
| `GET` | `/api/v1/auth/me` | Devuelve el `SessionUser` asociado al token. |

El login busca el correo en `mail` y valida la contraseña mediante bind LDAPS con el DN del usuario. El rol se asigna según la pertenencia a los grupos de seguridad indicados por `AUTH_GROUP_ADMIN_DN`, `AUTH_GROUP_SUPERVISOR_DN` y `AUTH_GROUP_USER_DN`; el backend verifica que sean grupos security-enabled y contempla membresía anidada. Si la cuenta coincide con más de uno, aplica la prioridad `Administrador` > `Supervisor` > `Usuario`. Si no coincide con ninguno o los DN están vacíos, asigna el rol mínimo `Usuario`. `employeeType` no concede permisos y `department` se devuelve como `area`. La cuenta de servicio debe poder leer los grupos y su atributo `member`. Las sesiones son tokens aleatorios revocables guardados en memoria del proceso; se pierden al reiniciar y requieren afinidad de sesión si se ejecuta más de una instancia. Para despliegues con varias instancias, sustituir el almacén en memoria por uno compartido.

El servidor aplica los permisos de GestioApp a las rutas versionadas de usuarios: Administrador tiene acceso total, Supervisor puede consultar usuarios y Usuario no puede acceder a esa API. Los intentos fallidos de login se limitan a 10 por IP cada 15 minutos.

| Método | Ruta | Acción |
| --- | --- | --- |
| `GET` | `/api/v1/users` | Lista `{ items, total }`. |
| `POST` | `/api/v1/users` | Crea con `name`, `rut`, `email`, `password`, `role` y `area`; devuelve el usuario directamente. |
| `GET` | `/api/v1/users/:id` | Obtiene por GUID de AD. |
| `PUT` | `/api/v1/users/:id` | Actualiza los campos del usuario. La contraseña es opcional. |
| `PATCH` | `/api/v1/users/:id/status` | Cambia `status` entre `active` y `disabled`. |
| `DELETE` | `/api/v1/users/:id` | Elimina la cuenta y responde `204`. |
| `GET` | `/api/v1/users/:id/backups` | Responde `501 BACKUPS_UNAVAILABLE`; este backend no administra respaldos. |

Al crear o editar usuarios, el campo `role` también se guarda en `employeeType` como dato descriptivo; durante el login los permisos se determinan exclusivamente por los grupos de seguridad configurados. `rut` se guarda en `employeeID` y `area` en `department`. El nombre de cuenta AD se deriva de la parte local del correo; el GUID de AD es el `id` público. RUT se valida con módulo 11 y se normaliza al formato `12.345.678-5`. Los campos que no administra AD (`assetCount`, `lastAccess` y `avgConnectionMin`) se devuelven como `0` o `null`.

La UI frontend sigue en modo `mock` por defecto. Para probar el backend, configure `CONFIG.api.mode = 'http'` y `CONFIG.api.baseUrl = 'http://localhost:3000/api/v1'` (o use un proxy same-origin). El backend de este proyecto implementa autenticación y usuarios; los demás grupos de rutas que consume el frontend (dashboard, activos, auditoría y respaldos) aún requieren sus propios servicios. Al no haber API de activos, eliminar un usuario no libera asignaciones y `assetCount` se mantiene en cero; `/backups` devuelve `501` de forma explícita.

### API LDAP original

Las rutas existentes bajo `/api/users` se mantienen por compatibilidad. Los campos retornados nunca incluyen la contraseña ni atributos de credenciales.

| Método | Ruta | Acción |
| --- | --- | --- |
| `GET` | `/health` | Estado del proceso. |
| `GET` | `/api/users?limit=25&offset=0` | Lista usuarios paginados; `limit` máximo 100. |
| `GET` | `/api/users/:username` | Obtiene un usuario por `sAMAccountName`. |
| `POST` | `/api/users` | Crea usuario. Requiere `username`, `userPrincipalName`, `password`, `givenName`, `surname` y `displayName`; `email`, `department`, `title` y `enabled` son opcionales. |
| `PATCH` | `/api/users/:username` | Cambia `password`, nombres, correo, departamento, cargo o estado `enabled`. |
| `DELETE` | `/api/users/:username` | Elimina al usuario. |

Los errores usan JSON `{ "error": "..." }`; códigos habituales: `400` validación, `401` token inválido, `404` no existe, `409` nombre duplicado y `500` error interno. La lista responde `{ "data": [...], "pagination": { "limit", "offset", "hasMore" } }`.

Ejemplo de alta:

```bash
curl -X POST http://localhost:3000/api/users \
  -H 'authorization: Bearer replace-with-your-api-token' \
  -H 'content-type: application/json' \
  -d '{
    "username": "ana.perez",
    "userPrincipalName": "ana.perez@empresa.local",
    "password": "CambiarEstaClave123!",
    "givenName": "Ana",
    "surname": "Perez",
    "displayName": "Ana Perez",
    "email": "ana.perez@empresa.local",
    "enabled": true
  }'
```

## Seguridad y comportamiento AD

- `unicodePwd` se envía como bytes UTF-16LE con comillas, únicamente sobre LDAPS. La cuenta debe tener permisos para cambiar contraseñas y la clave debe cumplir la política del dominio.
- Usuarios habilitados se crean con `userAccountControl=512`; la actualización de estado preserva los demás bits del atributo.
- Los filtros LDAP escapan valores; la entrada no puede elegir DN ni OU. El nombre de usuario se limita a caracteres seguros y se usa como RDN bajo `LDAP_USERS_OU`.
- Limita `LDAP_USERS_OU` al mínimo privilegio, restringe el acceso de red y guarda los secretos en un gestor de secretos. El token compartido no sustituye autorización por usuario final; en despliegues multiusuario, valida identidades y permisos en un proxy o proveedor de identidad.
- La lista usa paginación LDAP y se detiene tras encontrar el tramo solicitado y un elemento adicional para calcular `hasMore`.