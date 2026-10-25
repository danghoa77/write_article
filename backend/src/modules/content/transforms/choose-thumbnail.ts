// @ts-nocheck
// Ported from connected n8n node Code in JavaScript5. No runtime eval.
export async function chooseThumbnail(
  this: any,
  inputItems: any[],
  context: any = {},
) {
  const $input = { all: () => inputItems, first: () => inputItems[0] };
  const $ = (name: string) => ({ all: () => context.nodes?.[name] ?? [] });
  const $getWorkflowStaticData = () => context.history ?? {};
  // ============================================================
  // NODE: Pick Final Thumbnail (giữ nguyên title/caption/content)
  // Mode: Run Once for All Items
  // Input:
  //   - 1 item bài viết: { title, caption, content }  (KHÔNG có "images")
  //   - N item nhóm ảnh: { searchParameters: { q }, images: [...] }
  // Output: 1 item duy nhất { title, caption, content, thumbnailUrl, thumbnailTier }
  // ============================================================

  const allItems = $input.all();

  const postItem = allItems.find(
    (i) => Array.isArray(i.json.images) !== true && i.json.title !== undefined,
  );
  const imageGroups = allItems.filter((i) => Array.isArray(i.json.images));

  if (!postItem) {
    throw new Error(
      'Không tìm thấy item bài viết (title/caption/content) trong input.',
    );
  }

  // ===== Static Data: lưu lịch sử thumbnail đã dùng, tồn tại xuyên suốt các lần chạy =====
  const staticData = $getWorkflowStaticData('global');
  if (!staticData.usedThumbnails) staticData.usedThumbnails = []; // mảng URL đã dùng gần đây

  // ===== Domain rules =====
  const HARD_BLOCKED_DOMAINS = [
    'encrypted-tbn0.gstatic.com',
    'encrypted-tbn1.gstatic.com',
    'encrypted-tbn2.gstatic.com',
    'encrypted-tbn3.gstatic.com',
    'gstatic.com',
    'googleusercontent.com',
  ];
  const RISKY_DOMAINS = [
    'lookaside.fbsbx.com',
    'lookaside.instagram.com',
    'instagram.com',
    'facebook.com',
    'tiktok.com',
  ];
  const TRUSTED_DOMAINS = [
    'gettyimages.com',
    'gettyimages.co.uk',
    'gettyimages.com.au',
    'wikimedia.org',
    'afc.com.au',
    'afl.com.au',
    'richmondfc.com.au',
    'adelaideoval.com.au',
    'theguardian.com',
    'abc.net.au',
  ];

  const LOGO_KEYWORDS =
    /\blogo\b|\bemblem\b|\bcrest\b|\bbadge\b|die cut sticker/i;
  const VALID_EXT_REGEX = /\.(jpe?g|png|webp)(\?.*)?$/i;

  // Query càng chung chung (không gắn tên riêng) thì càng bị hạ điểm khi làm thumbnail đại diện
  const GENERIC_QUERY_REGEX =
    /\b(team players on field|players on field|on field|action shot|match action)\b/i;

  function getDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }
  function isHardBlocked(domain) {
    return HARD_BLOCKED_DOMAINS.some((d) => domain.includes(d));
  }
  function isRisky(domain) {
    return RISKY_DOMAINS.some((d) => domain.includes(d));
  }

  function scoreImage(img, isGenericQuery) {
    const url = img.imageUrl || '';
    const title = img.title || '';
    const domain = getDomain(url);

    if (isHardBlocked(domain)) return -1;
    if (LOGO_KEYWORDS.test(title)) return -1;
    if (!VALID_EXT_REGEX.test(url)) return -1;

    const w = img.imageWidth || 0,
      h = img.imageHeight || 0;
    if (w < 400 || h < 300) return -1;

    let score = w * h;

    if (TRUSTED_DOMAINS.some((d) => domain.includes(d))) score *= 1.3;
    if (isRisky(domain)) score *= 0.2; // vẫn cho phép nhưng phạt nặng

    const ratio = w / h;
    if (ratio > 2.2 || ratio < 0.3) score *= 0.6;

    // Ưu tiên ảnh nhân vật/đội cụ thể hơn ảnh minh hoạ chung chung
    if (isGenericQuery) score *= 0.5;

    return score;
  }

  async function isImageAccessible(url) {
    try {
      const res = await this.helpers.httpRequest({
        method: 'GET',
        url,
        returnFullResponse: true,
        encoding: 'arraybuffer',
        timeout: 7000,
        maxRedirects: 5,
        ignoreHttpStatusErrors: true,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          Referer: 'https://www.google.com/',
        },
      });
      const status = res.statusCode || 0;
      const contentType = (
        (res.headers &&
          (res.headers['content-type'] || res.headers['Content-Type'])) ||
        ''
      ).toLowerCase();
      const bodyLength = res.body ? res.body.length : 0;

      if (status < 200 || status >= 300) return false;
      if (contentType && !contentType.includes('image')) return false;
      if (bodyLength < 800) return false;
      return true;
    } catch {
      return false;
    }
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function tryVerifyPool(candidates) {
    const shuffled = shuffle(candidates);
    for (const c of shuffled) {
      const ok = await isImageAccessible.call(this, c.imageUrl);
      if (ok) return c.imageUrl;
    }
    return null;
  }

  // ===== Gộp toàn bộ ảnh từ mọi nhóm, gắn điểm số =====
  let pool = [];
  for (const group of imageGroups) {
    const q = group.json.searchParameters?.q || '';
    const isGeneric = GENERIC_QUERY_REGEX.test(q);
    const images = group.json.images || [];

    for (const img of images) {
      const score = scoreImage(img, isGeneric);
      if (score > 0) {
        pool.push({ ...img, __score: score, __query: q });
      }
    }
  }

  pool.sort((a, b) => b.__score - a.__score);

  // ===== Chọn theo tier, chống lặp, verify sống =====
  const usedUrls = staticData.usedThumbnails;

  async function pickThumbnail() {
    const tiers = [
      { topN: 5, filterUsed: true },
      { topN: 10, filterUsed: true },
      { topN: pool.length, filterUsed: false }, // hết cách thì chấp nhận lặp
    ];

    for (let t = 0; t < tiers.length; t++) {
      const { topN, filterUsed } = tiers[t];
      let candidates = filterUsed
        ? pool.filter((img) => !usedUrls.includes(img.imageUrl))
        : pool;
      candidates = candidates.slice(0, topN);
      if (!candidates.length) continue;

      const result = await tryVerifyPool.call(this, candidates);
      if (result) return { url: result, tier: t + 1 };
    }
    return { url: null, tier: 0 };
  }

  const { url: thumbnailUrl, tier } = pool.length
    ? await pickThumbnail.call(this)
    : { url: null, tier: 0 };

  if (thumbnailUrl) {
    staticData.usedThumbnails = [...usedUrls, thumbnailUrl].slice(-30); // giới hạn lịch sử 30 URL
  }

  return [
    {
      json: {
        title: postItem.json.title,
        caption: postItem.json.caption,
        content: postItem.json.content,
        thumbnailUrl,
        thumbnailTier: tier,
      },
    },
  ];
}
