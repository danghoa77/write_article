// @ts-nocheck
// Ported from connected n8n node convertContentImage5. No runtime eval.
export async function insertImages(
  this: any,
  inputItems: any[],
  context: any = {},
) {
  const $input = { all: () => inputItems, first: () => inputItems[0] };
  const $ = (name: string) => ({ all: () => context.nodes?.[name] ?? [] });
  const $getWorkflowStaticData = () => context.history ?? {};
  const originalItems = $('getInfoForSearch1').all();
  const searchResults = $input.all();

  // Gom nhóm các placeholder theo từng bài viết (dựa vào originalContent)
  const articlesMap = new Map();

  for (let i = 0; i < originalItems.length; i++) {
    const item = originalItems[i].json;
    const key = item.originalContent; // dùng content gốc làm khóa nhóm bài

    if (!articlesMap.has(key)) {
      articlesMap.set(key, {
        title: item.title,
        caption: item.caption,
        content: item.originalContent,
        replacements: [], // danh sách {placeholder, imageUrl, query}
      });
    }

    // Data Tavily: json.images là mảng string URL (không phải object)
    const tavilyResult = searchResults[i]?.json || {};
    const topImages = Array.isArray(tavilyResult.images)
      ? tavilyResult.images
      : [];

    // Fallback: nếu top-level images rỗng, lấy ảnh từ trong results[].images
    let fallbackImages = [];
    if (topImages.length === 0 && Array.isArray(tavilyResult.results)) {
      for (const r of tavilyResult.results) {
        if (Array.isArray(r.images) && r.images.length > 0) {
          fallbackImages = r.images;
          break;
        }
      }
    }

    const candidateImages = topImages.length > 0 ? topImages : fallbackImages;

    // Lọc bớt các URL rõ ràng là icon/logo nhỏ (tuỳ chọn, dựa theo tên file)
    const filtered = candidateImages.filter(
      (url) => typeof url === 'string' && !/logo|icon|badge|favicon/i.test(url),
    );

    const goodImageUrl = filtered[0] || candidateImages[0] || null;

    articlesMap.get(key).replacements.push({
      placeholder: item.placeholder,
      imageUrl: goodImageUrl,
      query: item.query,
    });
  }

  // Với mỗi bài viết, thay toàn bộ placeholder tương ứng
  const results = [];
  for (const article of articlesMap.values()) {
    let content = article.content;
    for (const r of article.replacements) {
      if (r.imageUrl) {
        const imgTag = `<img src="${r.imageUrl}" alt="${r.query}">`;
        content = content.replace(r.placeholder, imgTag);
      } else {
        content = content.replace(r.placeholder, '');
      }
    }
    results.push({
      json: {
        title: article.title,
        caption: article.caption,
        content: content,
      },
    });
  }

  return results;
}
