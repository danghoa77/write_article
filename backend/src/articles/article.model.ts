export interface Article {
  id: number;
  title: string;
  status: 'draft' | 'published';
}