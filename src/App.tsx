import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { HomePage } from './routes/HomePage';
import { WatchPage } from './routes/WatchPage';
import { Stage1APlayerProvider } from './components/Stage1APlayerDock';

function ScrollToTop() {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    if (hash) return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
  }, [pathname, search, hash]);

  return null;
}

export default function App() {
  return (
    <Stage1APlayerProvider>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/watch/:contentId" element={<WatchPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Stage1APlayerProvider>
  );
}
