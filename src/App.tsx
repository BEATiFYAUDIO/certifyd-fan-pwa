import { Navigate, Route, Routes } from 'react-router-dom';
import { HomePage } from './routes/HomePage';
import { WatchPage } from './routes/WatchPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/watch/:contentId" element={<WatchPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
