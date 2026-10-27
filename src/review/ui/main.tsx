import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../template/fonts.css';
import './review.css';
import { ReviewPage } from './App';
import { jobClient } from './api';
import { Home, JobPage, LibraryPage, NewJob, SettingsPage } from './pages';

/** Einfache Hash-Navigation: #/, #/neu, #/job/<id>, #/einstellungen, #/bibliothek, #/review (Einzel-Review) */
function Router() {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const on = () => {
      setHash(location.hash || '#/');
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const single = useMemo(() => jobClient('/api'), []);
  const job = hash.match(/^#\/job\/([a-z0-9-]+)/);
  if (hash.startsWith('#/review')) return <ReviewPage api={single} />;
  if (job) return <JobPage key={job[1]} id={job[1]} />;
  if (hash.startsWith('#/neu')) return <NewJob />;
  if (hash.startsWith('#/einstellungen')) return <SettingsPage />;
  if (hash.startsWith('#/bibliothek')) return <LibraryPage />;
  return <Home />;
}

createRoot(document.getElementById('app')!).render(<Router />);
