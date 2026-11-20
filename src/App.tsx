import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useSettings } from '@/store/settings';
import PracticePage from '@/pages/PracticePage';
import WordsPage from '@/pages/WordsPage';
import ReviewPage from '@/pages/ReviewPage';
import ArticlesPage from '@/pages/ArticlesPage';
import SentencesPage from '@/pages/SentencesPage';
import StatsPage from '@/pages/StatsPage';
import AchievementsPage from '@/pages/AchievementsPage';
import SettingsPage from '@/pages/SettingsPage';

export default function App() {
  const load = useSettings((s) => s.load);
  const ready = useSettings((s) => s.ready);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
          <span className="text-xs text-muted">正在加载本地数据…</span>
        </div>
      </div>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<PracticePage />} />
        <Route path="/practice" element={<PracticePage />} />
        <Route path="/words" element={<WordsPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/articles" element={<ArticlesPage />} />
        <Route path="/sentences" element={<SentencesPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/achievements" element={<AchievementsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route
          path="*"
          element={
            <div className="flex h-full flex-col items-center justify-center gap-2">
              <span className="text-sm text-ink">页面不存在</span>
              <a href="/" className="text-xs text-accent hover:underline">
                回到练习页
              </a>
            </div>
          }
        />
      </Routes>
    </Layout>
  );
}
