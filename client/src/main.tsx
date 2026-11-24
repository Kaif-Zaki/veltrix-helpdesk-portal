import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {AsgardeoProvider} from '@asgardeo/react';
import App from './App';
import './index.css';

const baseUrl = import.meta.env.VITE_ASGARDEO_BASE_URL ?? 'https://api.asgardeo.io/t/veltrix';
const clientId = import.meta.env.VITE_ASGARDEO_CLIENT_ID ?? '';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AsgardeoProvider
      baseUrl={baseUrl}
      clientId={clientId}
      afterSignInUrl={window.location.origin}
      afterSignOutUrl={window.location.origin}
      storage="localStorage"
      scopes="openid profile email requests:read requests:create requests:approve requests:delete"
      preferences={{
        theme: {
          inheritFromBranding: false,
          mode: 'light',
        },
        user: {
          fetchOrganizations: false,
          fetchUserProfile: false,
        },
      }}
    >
      <App />
    </AsgardeoProvider>
  </StrictMode>,
);
