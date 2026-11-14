import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return <p>Voxel PM2.5</p>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
