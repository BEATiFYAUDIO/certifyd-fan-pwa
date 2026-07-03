import { useEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
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

function PlayerSidebar() {
  const location = useLocation();
  const contextHref = (hash: string) => `/${location.search}${hash}`;
  const groups = [
    {
      label: 'Charts',
      items: [
        { label: 'Network Pulse', href: contextHref('#creator-economy-board'), active: location.hash === '' || location.hash === '#creator-economy-board' },
        { label: 'Active Creator Ecosystems', href: contextHref('#active-creator-ecosystems'), active: location.hash === '#active-creator-ecosystems' },
        { label: 'Recently Published', href: contextHref('#recently-published'), active: location.hash === '#recently-published' },
        { label: 'Top Selling', href: contextHref('#top-selling'), active: location.hash === '#top-selling' },
        { label: 'Top Connected', href: contextHref('#top-connected'), active: location.hash === '#top-connected' },
        { label: 'Fastest Moving', href: contextHref('#fastest-moving'), active: location.hash === '#fastest-moving' },
      ],
    },
    {
      label: 'Explore',
      items: [
        { label: 'Free Drops', href: contextHref('#free-drops'), active: location.hash === '#free-drops' },
        { label: 'Premium Works', href: contextHref('#premium-works'), active: location.hash === '#premium-works' },
      ],
    },
    {
      label: 'Your World',
      items: [
        { label: 'Following', href: contextHref('#following'), active: location.hash === '#following' },
        { label: 'Recently Played', href: contextHref('#recently-played'), active: location.hash === '#recently-played' },
        { label: 'Saved', href: contextHref('#saved'), active: location.hash === '#saved' },
      ],
    },
  ];
  return (
    <aside className="certifyd-player-left-panel" aria-label="Discovery signal boards">
      <Link to="/" className="certifyd-player-brand" aria-label="Certifyd Player home">
        <span className="certifyd-player-brand-main">CERTIFYD</span>
        <span className="certifyd-player-brand-pill">Player</span>
      </Link>
      <Link to={`/${location.search}#certifyd-player-search`} className="certifyd-player-search-link">
        Search
      </Link>
      <nav className="certifyd-player-nav" aria-label="Certifyd Player navigation">
        {groups.map((group) => (
          <div key={group.label} className="certifyd-player-nav-group">
            <div className="certifyd-player-section-label">{group.label}</div>
            {group.items.map((item) => (
              <Link
                key={`${group.label}:${item.label}`}
                to={item.href}
                className={`certifyd-player-nav-item ${item.active ? 'certifyd-player-nav-item-active' : ''}`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function PlayerShell() {
  return (
    <div className="certifyd-player-shell">
      <PlayerSidebar />
      <div className="certifyd-player-center">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/watch/:contentId" element={<WatchPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Stage1APlayerProvider>
      <ScrollToTop />
      <PlayerShell />
    </Stage1APlayerProvider>
  );
}
