import { useState } from 'react';

type Article = {
  id: number;
  title: string;
  status: 'draft' | 'published';
};

export default function App() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadArticles() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/articles');

      if (!response.ok) {
        throw new Error(`API trả về HTTP ${response.status}`);
      }

      const data: Article[] = await response.json();
      setArticles(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Không kết nối được backend',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 720,
        margin: '40px auto',
        padding: 24,
      }}
    >
      <h1>React + NestJS</h1>
      <p>Bản thử kết nối frontend và backend.</p>

      <button
        onClick={loadArticles}
        disabled={loading}
      >
        {loading ? 'Đang tải...' : 'Kiểm tra API'}
      </button>

      {error && <p role="alert">{error}</p>}

      <ul>
        {articles.map((article) => (
          <li key={article.id}>
            {article.title} — {article.status}
          </li>
        ))}
      </ul>
    </main>
  );
}