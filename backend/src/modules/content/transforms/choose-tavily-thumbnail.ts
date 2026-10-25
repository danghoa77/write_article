// @ts-nocheck
// Ported from n8n node Code in JavaScript7; enabled by explicit Tavily option.
export async function chooseTavilyThumbnail(
  this: any,
  inputItems: any[],
  context: any = {},
) {
  const $input = { all: () => inputItems };
  const $getWorkflowStaticData = () => context.history ?? {};
  // ============================================================
  // NODE: Pick Final Thumbnail (giu nguyen title/caption/content)
  // Mode: Run Once for All Items
  // Input:
  //   - 1 item bai viet: { title, caption, content }
  //   - N item nhom anh Tavily: { query, images: [string...], results: [{ images: [string...] }] }
  // Output: 1 item duy nhat { title, caption, content, thumbnailUrl, thumbnailTier }
  // ============================================================

  const allItems = $input.all();

  const postItem = allItems.find(function (i) {
    return Array.isArray(i.json.images) !== true && i.json.title !== undefined;
  });
  const imageGroups = allItems.filter(function (i) {
    return Array.isArray(i.json.images);
  });

  if (!postItem) {
    throw new Error(
      'Khong tim thay item bai viet (title/caption/content) trong input.',
    );
  }

  // ===== Static Data: luu lich su thumbnail da dung =====
  const staticData = $getWorkflowStaticData('global');
  if (!staticData.usedThumbnails) staticData.usedThumbnails = [];

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

  // Chi chap nhan dinh dang anh doc duoc thuc su (khong svg, khong gif hoat hinh)
  const VALID_EXT_REGEX = /\.(jpe?g|png|webp)(\?.*)?$/i;

  // Tu khoa logo/emblem/badge/crest/kit ao dau/co doi/icon/watermark - loai tuyet doi
  // Ap dung cho ca URL lan title vi nhieu CDN dat logo trong path (vd /images/large-logos/, /team-flags/, Kit_body_*.png)
  const NON_PHOTO_KEYWORDS = new RegExp(
    [
      'logo',
      'logos',
      'emblem',
      'crest',
      'badge',
      'die[\\s_-]?cut[\\s_-]?sticker',
      'sticker',
      'kit[_\\s-]?body',
      'kit[_\\s-]?shorts',
      'kit[_\\s-]?socks',
      'jumper',
      'guernsey',
      'jersey[_\\s-]?flat',
      'flag',
      'flags',
      'icon',
      'favicon',
      'watermark',
      'banner',
      'vector',
      'clipart',
      'silhouette',
      'commons-logo',
      'wiki.*icon',
      'sports_icon',
    ].join('|'),
    'i',
  );

  // Query cang chung chung thi cang bi ha diem khi lam thumbnail dai dien
  const GENERIC_QUERY_REGEX =
    /\b(team players on field|players on field|on field|action shot|match action)\b/i;

  function getDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }
  function isHardBlocked(domain) {
    return HARD_BLOCKED_DOMAINS.some(function (d) {
      return domain.indexOf(d) !== -1;
    });
  }
  function isRisky(domain) {
    return RISKY_DOMAINS.some(function (d) {
      return domain.indexOf(d) !== -1;
    });
  }

  // Nhieu CDN (afl.com.au, richmondfc.com.au, abc-cdn.net.au...) nhung san width/height trong query string
  function extractDimensions(url) {
    const w = url.match(/[?&](?:width|w)=(\d+)/i);
    const h = url.match(/[?&](?:height|h)=(\d+)/i);
    return {
      width: w ? parseInt(w[1], 10) : null,
      height: h ? parseInt(h[1], 10) : null,
    };
  }

  function isNonPhoto(url, title) {
    if (NON_PHOTO_KEYWORDS.test(url)) return true;
    if (NON_PHOTO_KEYWORDS.test(title)) return true;
    return false;
  }

  function scoreImage(img, isGenericQuery) {
    const url = img.imageUrl || '';
    const title = img.title || '';
    const domain = getDomain(url);

    if (!url) return -1;
    if (isHardBlocked(domain)) return -1;

    // Chi cho phep jpg/jpeg/png/webp - loai svg, gif, va bat ky duoi la khong doc duoc nhu anh that
    if (!VALID_EXT_REGEX.test(url)) return -1;

    // Loai logo/badge/flag/kit/icon/watermark/vector - khong phai anh nguoi that
    if (isNonPhoto(url, title)) return -1;

    const dims = extractDimensions(url);
    img.imageWidth = dims.width;
    img.imageHeight = dims.height;

    // Chi loai khi biet chac kich thuoc qua nho; khong ro thi giu lai
    if (dims.width !== null && dims.width < 400) return -1;
    if (dims.height !== null && dims.height < 300) return -1;

    // Anh gan vuong tuyet doi (1:1 hoac gan 1:1) thuong la logo/avatar - phat nhe neu kich thuoc nho vua
    if (dims.width && dims.height) {
      const isNearSquare =
        Math.abs(dims.width - dims.height) / Math.max(dims.width, dims.height) <
        0.05;
      if (isNearSquare && dims.width < 700) return -1;
    }

    let score = 400 * 300;
    if (dims.width && dims.height) {
      score = dims.width * dims.height;
    }

    if (
      TRUSTED_DOMAINS.some(function (d) {
        return domain.indexOf(d) !== -1;
      })
    )
      score = score * 1.3;
    if (isRisky(domain)) score = score * 0.2;

    if (dims.width && dims.height) {
      const ratio = dims.width / dims.height;
      if (ratio > 2.2 || ratio < 0.3) score = score * 0.6;
    }

    if (isGenericQuery) score = score * 0.5;

    return score;
  }

  async function isImageAccessible(url) {
    try {
      const res = await this.helpers.httpRequest({
        method: 'GET',
        url: url,
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
      const headers = res.headers || {};
      const contentType = (
        headers['content-type'] ||
        headers['Content-Type'] ||
        ''
      ).toLowerCase();
      const bodyLength = res.body ? res.body.length : 0;

      if (status < 200 || status >= 300) return false;
      // Content-Type phai la anh jpeg/png/webp thuc su (loai svg+xml, gif...)
      if (!contentType || !/image\/(jpe?g|png|webp)/.test(contentType))
        return false;
      if (bodyLength < 800) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  async function tryVerifyPool(candidates) {
    const shuffled = shuffle(candidates);
    for (let k = 0; k < shuffled.length; k++) {
      const c = shuffled[k];
      const ok = await isImageAccessible.call(this, c.imageUrl);
      if (ok) return c.imageUrl;
    }
    return null;
  }

  // ===== Gom toan bo anh Tavily: images top-level + images trong tung result =====
  function collectImagesFromGroup(json) {
    const collected = [];
    const seen = {};

    function push(url, title) {
      if (!url || typeof url !== 'string' || seen[url]) return;
      seen[url] = true;
      collected.push({ imageUrl: url, title: title || '' });
    }

    const topImages = Array.isArray(json.images) ? json.images : [];
    for (let i = 0; i < topImages.length; i++) {
      push(topImages[i], json.query || '');
    }

    const results = Array.isArray(json.results) ? json.results : [];
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const rImages = Array.isArray(r.images) ? r.images : [];
      for (let k = 0; k < rImages.length; k++) {
        push(rImages[k], r.title || json.query || '');
      }
    }

    return collected;
  }

  // ===== Gop toan bo anh tu moi nhom, gan diem so =====
  let pool = [];
  for (let g = 0; g < imageGroups.length; g++) {
    const group = imageGroups[g];
    const q = group.json.query || '';
    const isGeneric = GENERIC_QUERY_REGEX.test(q);
    const images = collectImagesFromGroup(group.json);

    for (let m = 0; m < images.length; m++) {
      const img = images[m];
      const score = scoreImage(img, isGeneric);
      if (score > 0) {
        img.__score = score;
        img.__query = q;
        pool.push(img);
      }
    }
  }

  pool.sort(function (a, b) {
    return b.__score - a.__score;
  });

  // ===== Chon theo tier, chong lap, verify song =====
  const usedUrls = staticData.usedThumbnails;

  async function pickThumbnail() {
    const tiers = [
      { topN: 5, filterUsed: true },
      { topN: 10, filterUsed: true },
      { topN: pool.length, filterUsed: false },
    ];

    for (let t = 0; t < tiers.length; t++) {
      const topN = tiers[t].topN;
      const filterUsed = tiers[t].filterUsed;
      let candidates = filterUsed
        ? pool.filter(function (img) {
            return usedUrls.indexOf(img.imageUrl) === -1;
          })
        : pool;
      candidates = candidates.slice(0, topN);
      if (!candidates.length) continue;

      const result = await tryVerifyPool.call(this, candidates);
      if (result) return { url: result, tier: t + 1 };
    }
    return { url: null, tier: 0 };
  }

  let thumbnailUrl = null;
  let tier = 0;

  if (pool.length) {
    const picked = await pickThumbnail.call(this);
    thumbnailUrl = picked.url;
    tier = picked.tier;
  }

  if (thumbnailUrl) {
    staticData.usedThumbnails = usedUrls.concat([thumbnailUrl]).slice(-30);
  }

  return [
    {
      json: {
        title: postItem.json.title,
        caption: postItem.json.caption,
        content: postItem.json.content,
        thumbnailUrl: thumbnailUrl,
        thumbnailTier: tier,
      },
    },
  ];
}
