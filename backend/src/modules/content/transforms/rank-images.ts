// @ts-nocheck
// Ported from connected n8n node pick_thumbnail_Image1. No runtime eval.
export async function rankImages(
  this: any,
  inputItems: any[],
  context: any = {},
) {
  const $input = { all: () => inputItems, first: () => inputItems[0] };
  const $ = (name: string) => ({ all: () => context.nodes?.[name] ?? [] });
  const $getWorkflowStaticData = () => context.history ?? {};
  const items = $input.all();

  // ===== Domain proxy/crawler — KHÔNG BAO GIỜ dùng =====
  const BLOCKED_DOMAINS = [
    'encrypted-tbn0.gstatic.com',
    'encrypted-tbn1.gstatic.com',
    'encrypted-tbn2.gstatic.com',
    'encrypted-tbn3.gstatic.com',
    'lookaside.instagram.com',
    'lookaside.fbsbx.com',
    'www.facebook.com',
    'tiktok.com',
  ];

  const VALID_EXT_REGEX = /\.(jpe?g|png|webp|gif)(\?.*)?$/i;
  const LOGO_KEYWORDS = /logo|crest|emblem|badge|die cut sticker|1000logos/i;
  const SVG_REGEX = /\.svg(\?.*)?$/i;

  function getDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  // ===== Static Data: lưu lịch sử ảnh đã dùng, tồn tại xuyên suốt các lần chạy workflow =====
  const staticData = $getWorkflowStaticData('global');
  if (!staticData.usedImagesByKey) {
    staticData.usedImagesByKey = {}; // { "richmond tigers|toby nankervis": ["url1", "url2", ...] }
  }

  // Chuẩn hoá key để nhóm lịch sử theo entity (đội/coach/cầu thủ), dựa trên query gốc
  // Loại các từ chung chung (photo, action, playing...) để nhóm đúng theo NHÂN VẬT/ĐỘI thay vì theo câu chữ chính xác
  function buildHistoryKey(query) {
    const stop =
      /\b(afl|nfl|ncaa|player|players|photo|photos|action|playing|match|on|field|during|at|the|of|in|for|team|club|game)\b/gi;
    return query
      .toLowerCase()
      .replace(stop, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function scoreImage(img) {
    const url = img.imageUrl || '';
    const title = img.title || '';
    const domain = getDomain(url);

    if (BLOCKED_DOMAINS.some((d) => domain.includes(d))) return -1;
    if (LOGO_KEYWORDS.test(title) || LOGO_KEYWORDS.test(url)) return -1;
    if (SVG_REGEX.test(url)) return -1;
    if (!VALID_EXT_REGEX.test(url)) return -1;

    const w = img.imageWidth || 0;
    const h = img.imageHeight || 0;
    if (w < 400 || h < 300) return -1;

    let score = w * h;

    const TRUSTED_DOMAINS = [
      'wikipedia.org',
      'afl.com.au',
      'richmondfc.com.au',
      'afc.com.au',
      'gettyimages.com',
      'gettyimages.com.au',
    ];
    if (TRUSTED_DOMAINS.some((d) => domain.includes(d))) score *= 1.3;

    const ratio = w / h;
    if (ratio > 2.2 || ratio < 0.3) score *= 0.6;

    return score;
  }

  // Random có trọng số nhẹ: pick ngẫu nhiên trong top N ứng viên gần điểm nhau,
  // thay vì luôn chọn cứng top-1 -> tăng đa dạng ngay cả khi lịch sử trống
  function pickRandomFromTop(sortedCandidates, topN = 3) {
    const pool = sortedCandidates.slice(
      0,
      Math.min(topN, sortedCandidates.length),
    );
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx];
  }

  return items.map((item) => {
    const images = item.json.images || [];
    const searchQuery = item.json.searchParameters?.q || '';
    const historyKey = buildHistoryKey(searchQuery);

    const usedUrls = staticData.usedImagesByKey[historyKey] || [];

    // Chấm điểm toàn bộ ứng viên hợp lệ
    const scored = images
      .map((img) => ({ ...img, __score: scoreImage(img) }))
      .filter((img) => img.__score > 0)
      .sort((a, b) => b.__score - a.__score);

    if (scored.length === 0) {
      return {
        json: {
          ...item.json,
          selectedImageUrl: '',
          selectedImageTitle: '',
          selectedImageWidth: null,
          selectedImageHeight: null,
          selectedImageSource: '',
          selectedImageFound: false,
        },
      };
    }

    // Ưu tiên 1: ảnh CHƯA từng dùng cho entity này
    const unused = scored.filter((img) => !usedUrls.includes(img.imageUrl));

    let chosen;
    if (unused.length > 0) {
      // Random trong top 3 ảnh chưa dùng (thay vì luôn lấy top-1) để tăng đa dạng
      chosen = pickRandomFromTop(unused, 3);
    } else {
      // Tất cả ứng viên tốt đều đã dùng hết -> random toàn bộ candidate hợp lệ
      // (chấp nhận lặp lại vì hết ảnh mới, nhưng ít nhất không luôn ra đúng 1 ảnh cố định)
      chosen = pickRandomFromTop(scored, Math.min(5, scored.length));
    }

    // Ghi nhận ảnh vừa chọn vào lịch sử, giới hạn tối đa 30 URL/entity để tránh phình dữ liệu vô hạn
    staticData.usedImagesByKey[historyKey] = [
      ...usedUrls,
      chosen.imageUrl,
    ].slice(-30);

    return {
      json: {
        ...item.json,
        selectedImageUrl: chosen.imageUrl,
        selectedImageTitle: chosen.title,
        selectedImageWidth: chosen.imageWidth,
        selectedImageHeight: chosen.imageHeight,
        selectedImageSource: getDomain(chosen.imageUrl),
        selectedImageFound: true,
      },
    };
  });
}
