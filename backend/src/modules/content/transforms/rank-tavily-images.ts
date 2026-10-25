// @ts-nocheck
// Ported from n8n node pick_thumbnail_Image3; enabled by explicit Tavily option.
export async function rankTavilyImages(
  this: any,
  inputItems: any[],
  context: any = {},
) {
  const $input = { all: () => inputItems };
  const $getWorkflowStaticData = () => context.history ?? {};
  const items = $input.all();

  // ===== Domain proxy/crawler - KHONG BAO GIO dung =====
  var BLOCKED_DOMAINS = [
    'encrypted-tbn0.gstatic.com',
    'encrypted-tbn1.gstatic.com',
    'encrypted-tbn2.gstatic.com',
    'encrypted-tbn3.gstatic.com',
    'lookaside.instagram.com',
    'lookaside.fbsbx.com',
    'www.facebook.com',
    'facebook.com',
    'instagram.com',
    'tiktok.com',
  ];

  var VALID_EXT_REGEX = /\.(jpe?g|png|webp|gif)(\?.*)?$/i;
  var LOGO_KEYWORDS =
    /logo|crest|emblem|badge|die cut sticker|1000logos|icon|favicon|sticker/i;
  var SVG_REGEX = /\.svg(\?.*)?$/i;

  function getDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  // Suy ra width/height tu query string cua URL neu CDN co nhung san (vd afl.com.au ?width=1064&height=600)
  function extractDimensions(url) {
    var w = url.match(/[?&](?:width|w)=(\d+)/i);
    var h = url.match(/[?&](?:height|h)=(\d+)/i);
    var width = w ? parseInt(w[1], 10) : null;
    var height = h ? parseInt(h[1], 10) : null;
    return { width: width, height: height };
  }

  // ===== Static Data =====
  var staticData = $getWorkflowStaticData('global');
  if (!staticData.usedImagesByKey) {
    staticData.usedImagesByKey = {};
  }

  function buildHistoryKey(query) {
    var stop =
      /\b(afl|nfl|ncaa|player|players|photo|photos|action|playing|match|on|field|during|at|the|of|in|for|team|club|game)\b/gi;
    return query
      .toLowerCase()
      .replace(stop, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function scoreImage(img) {
    var url = img.imageUrl || '';
    var title = img.title || '';
    var domain = getDomain(url);

    if (!url) return -1;
    if (
      BLOCKED_DOMAINS.some(function (d) {
        return domain.indexOf(d) !== -1;
      })
    )
      return -1;
    if (LOGO_KEYWORDS.test(title) || LOGO_KEYWORDS.test(url)) return -1;
    if (SVG_REGEX.test(url)) return -1;
    if (!VALID_EXT_REGEX.test(url)) return -1;

    var dims = extractDimensions(url);
    img.imageWidth = dims.width;
    img.imageHeight = dims.height;

    if (dims.width !== null && dims.width < 400) return -1;
    if (dims.height !== null && dims.height < 300) return -1;

    var score = 400 * 300;
    if (dims.width && dims.height) {
      score = dims.width * dims.height;
    }

    var TRUSTED_DOMAINS = [
      'wikipedia.org',
      'afl.com.au',
      'richmondfc.com.au',
      'afc.com.au',
      'gettyimages.com',
      'gettyimages.com.au',
      'carltonfc.com.au',
    ];
    if (
      TRUSTED_DOMAINS.some(function (d) {
        return domain.indexOf(d) !== -1;
      })
    ) {
      score = score * 1.3;
    }

    if (dims.width && dims.height) {
      var ratio = dims.width / dims.height;
      if (ratio > 2.2 || ratio < 0.3) {
        score = score * 0.6;
      }
    }

    return score;
  }

  function pickRandomFromTop(sortedCandidates, topN) {
    var n = topN || 3;
    var pool = sortedCandidates.slice(0, Math.min(n, sortedCandidates.length));
    var idx = Math.floor(Math.random() * pool.length);
    return pool[idx];
  }

  // Gom toan bo anh ung vien: images top-level + images trong tung result, khu trung lap
  function collectCandidates(json) {
    var candidates = [];
    var seen = {};

    function pushImage(url, title) {
      if (!url) return;
      if (typeof url !== 'string') return;
      if (seen[url]) return;
      seen[url] = true;
      candidates.push({ imageUrl: url, title: title || '' });
    }

    var topImages = Array.isArray(json.images) ? json.images : [];
    for (var i = 0; i < topImages.length; i++) {
      pushImage(topImages[i], json.query || '');
    }

    var results = Array.isArray(json.results) ? json.results : [];
    for (var j = 0; j < results.length; j++) {
      var r = results[j];
      var rImages = Array.isArray(r.images) ? r.images : [];
      for (var k = 0; k < rImages.length; k++) {
        pushImage(rImages[k], r.title || json.query || '');
      }
    }

    return candidates;
  }

  return items.map(function (item) {
    var searchQuery = item.json.query || '';
    var historyKey = buildHistoryKey(searchQuery);
    var usedUrls = staticData.usedImagesByKey[historyKey] || [];

    var candidates = collectCandidates(item.json);

    var scored = candidates
      .map(function (img) {
        var s = scoreImage(img);
        img.__score = s;
        return img;
      })
      .filter(function (img) {
        return img.__score > 0;
      })
      .sort(function (a, b) {
        return b.__score - a.__score;
      });

    if (scored.length === 0) {
      return {
        json: Object.assign({}, item.json, {
          selectedImageUrl: '',
          selectedImageTitle: '',
          selectedImageWidth: null,
          selectedImageHeight: null,
          selectedImageSource: '',
          selectedImageFound: false,
        }),
      };
    }

    var unused = scored.filter(function (img) {
      return usedUrls.indexOf(img.imageUrl) === -1;
    });

    var chosen;
    if (unused.length > 0) {
      chosen = pickRandomFromTop(unused, 3);
    } else {
      chosen = pickRandomFromTop(scored, Math.min(5, scored.length));
    }

    staticData.usedImagesByKey[historyKey] = usedUrls
      .concat([chosen.imageUrl])
      .slice(-30);

    return {
      json: Object.assign({}, item.json, {
        selectedImageUrl: chosen.imageUrl,
        selectedImageTitle: chosen.title,
        selectedImageWidth:
          chosen.imageWidth != null ? chosen.imageWidth : null,
        selectedImageHeight:
          chosen.imageHeight != null ? chosen.imageHeight : null,
        selectedImageSource: getDomain(chosen.imageUrl),
        selectedImageFound: true,
      }),
    };
  });
}
