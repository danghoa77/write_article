export interface Article {
  id: number;
  title: string;
  status: 'draft' | 'published';
}

// Exact outgoing body fields from workflow node put_data1.
export interface UpdateArticleBody {
  categories: number[];
  title: string;
  content: string;
  slug: string;
  featured_image: string;
  featured_image_thumbnail: string;
}

export interface ArticleSlugBody {
  title: string;
  postId: string;
  suffix?: string;
}
