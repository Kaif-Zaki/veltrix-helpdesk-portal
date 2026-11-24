import path from 'node:path';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import {createApp} from './app.js';
import {createAuthMiddleware, createJwksTokenVerifier} from './middleware/auth.js';
import {RequestStore} from './store/requestStore.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4000);
const baseUrl = (process.env.ASGARDEO_BASE_URL ?? 'https://api.asgardeo.io/t/veltrix').replace(/\/+$/, '');
const jwksUrl = process.env.ASGARDEO_JWKS_URL ?? `${baseUrl}/oauth2/jwks`;
const issuer = process.env.ASGARDEO_ISSUER ?? `${baseUrl}/oauth2/token`;
const clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

const store = new RequestStore(path.resolve(__dirname, '../data/requests.json'));
const verifier = createJwksTokenVerifier(jwksUrl, issuer);
const authMiddleware = createAuthMiddleware(verifier);

const app = createApp({authMiddleware, store, clientOrigin});

app.listen(port, () => {
  console.log(`Identity Helpdesk API listening on http://localhost:${port}`);
  console.log(`Verifying WSO2 Identity Platform JWTs via ${jwksUrl}`);
});
