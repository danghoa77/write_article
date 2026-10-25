// @ts-nocheck
// Ported from connected n8n node getInfoForSearch1. No runtime eval.
export async function buildImageQueries(
  this: any,
  inputItems: any[],
  context: any = {},
) {
  const $input = { all: () => inputItems, first: () => inputItems[0] };
  const $ = (name: string) => ({ all: () => context.nodes?.[name] ?? [] });
  const $getWorkflowStaticData = () => context.history ?? {};
  const allInputs = $input.all();
  const results = [];

  // ===== SPORT_SIGNATURES, scoreTextAgainstSport, detectSport, normalize giữ nguyên y hệt bản trước =====
  const SPORT_SIGNATURES = [
    {
      sport: 'Australian rules football',
      league: 'AFL',
      extraKeyword: 'AFL',
      signals: [
        { pattern: /\bafl\b/i, weight: 3 },
        { pattern: /australian rules football/i, weight: 4 },
        { pattern: /\bfooty\b/i, weight: 1 }, // hạ trọng số vì NRL cũng dùng từ này
        { pattern: /\bguernsey\b/i, weight: 3 },
        { pattern: /\bpremiership\b/i, weight: 1 }, // hạ trọng số vì dùng chung với NRL
        { pattern: /the mcg\b|melbourne cricket ground/i, weight: 3 },
        { pattern: /\boval\b/i, weight: 1 },
        { pattern: /grand final\b/i, weight: 1 }, // hạ trọng số vì NRL cũng có Grand Final
      ],
    },
    {
      // ===== MỚI: NRL =====
      sport: 'Rugby League',
      league: 'NRL',
      extraKeyword: 'NRL',
      signals: [
        { pattern: /\bnrl\b/i, weight: 5 }, // tín hiệu mạnh nhất, gần như chắc chắn là NRL
        { pattern: /rugby league/i, weight: 4 },
        { pattern: /\btry\b|\btries\b/i, weight: 2 }, // "try" = pha ghi điểm đặc trưng của rugby
        { pattern: /\btackle(d|s)?\b/i, weight: 2 },
        {
          pattern: /\bhalfback\b|\bhooker\b|\bfullback\b|\bfive[- ]eighth\b/i,
          weight: 3,
        }, // vị trí đặc trưng NRL
        { pattern: /state of origin/i, weight: 4 }, // giải đấu biểu tượng của NRL
        { pattern: /\bgrand final\b/i, weight: 1 },
        { pattern: /\bpremiership\b/i, weight: 1 },
        { pattern: /\bfooty\b/i, weight: 1 },
      ],
    },
    {
      sport: 'American football (NFL)',
      league: 'NFL',
      extraKeyword: 'NFL',
      signals: [
        { pattern: /\bnfl\b/i, weight: 3 },
        { pattern: /super bowl/i, weight: 4 },
        { pattern: /\bquarterback\b/i, weight: 2 },
        { pattern: /\btouchdown\b/i, weight: 2 },
        { pattern: /head coach\b.*\b(nfl|franchise)\b/i, weight: 2 },
        { pattern: /\bstadium\b/i, weight: 1 },
      ],
    },
    {
      sport: 'college football (NCAA)',
      league: 'NCAA',
      extraKeyword: 'NCAA college football',
      signals: [
        { pattern: /\bncaa\b/i, weight: 3 },
        { pattern: /college football/i, weight: 4 },
        { pattern: /transfer portal/i, weight: 3 },
        { pattern: /\bcampus\b/i, weight: 1 },
        { pattern: /university of\b/i, weight: 2 },
        { pattern: /bowl game\b/i, weight: 2 },
      ],
    },
    {
      sport: 'basketball (NBA)',
      league: 'NBA',
      extraKeyword: 'NBA',
      signals: [
        { pattern: /\bnba\b/i, weight: 3 },
        { pattern: /\bslam dunk\b/i, weight: 2 },
        {
          pattern: /\bplayoffs?\b.*\bnba\b|\bnba\b.*\bplayoffs?\b/i,
          weight: 2,
        },
        { pattern: /\bthree[- ]pointer\b/i, weight: 2 },
        { pattern: /\barena\b/i, weight: 1 },
      ],
    },
    {
      sport: "women's basketball (WNBA)",
      league: 'WNBA',
      extraKeyword: 'WNBA',
      signals: [
        { pattern: /\bwnba\b/i, weight: 5 },
        { pattern: /women'?s basketball/i, weight: 4 },
        { pattern: /\bwnba (finals|playoffs|draft)\b/i, weight: 4 },
        { pattern: /\bslam dunk\b/i, weight: 1 },
        { pattern: /\bthree[- ]pointer\b/i, weight: 1 },
        { pattern: /\barena\b/i, weight: 1 },
        {
          pattern: /\bcaitlin clark\b|\ba'ja wilson\b|\bbreanna stewart\b/i,
          weight: 3,
        },
      ],
    },
    {
      sport: 'ice hockey (NHL)',
      league: 'NHL',
      extraKeyword: 'NHL',
      signals: [
        { pattern: /\bnhl\b/i, weight: 3 },
        { pattern: /\bstanley cup\b/i, weight: 4 },
        { pattern: /\bpuck\b/i, weight: 2 },
        { pattern: /\bpower play\b/i, weight: 2 },
      ],
    },
    {
      sport: 'baseball (MLB)',
      league: 'MLB',
      extraKeyword: 'MLB',
      signals: [
        { pattern: /\bmlb\b/i, weight: 3 },
        { pattern: /\bworld series\b/i, weight: 4 },
        { pattern: /\bhome run\b/i, weight: 2 },
        { pattern: /\bpitcher\b/i, weight: 2 },
      ],
    },
    {
      sport: 'football/soccer',
      league: 'football (soccer)',
      extraKeyword: 'soccer football club',
      signals: [
        { pattern: /\bpremier league\b/i, weight: 3 },
        { pattern: /\bchampions league\b/i, weight: 3 },
        { pattern: /\bfifa\b/i, weight: 2 },
        { pattern: /\bpenalty kick\b/i, weight: 2 },
        { pattern: /\bmidfielder\b/i, weight: 1 },
      ],
    },
  ];

  const MIN_CONFIDENCE_SCORE = 3;

  function scoreTextAgainstSport(text, sportDef) {
    let score = 0;
    for (const { pattern, weight } of sportDef.signals) {
      if (pattern.test(text)) score += weight;
    }
    return score;
  }

  function detectSport(fullText) {
    let best = null;
    let bestScore = 0;
    for (const sportDef of SPORT_SIGNATURES) {
      const score = scoreTextAgainstSport(fullText, sportDef);
      if (score > bestScore) {
        bestScore = score;
        best = sportDef;
      }
    }
    if (best && bestScore >= MIN_CONFIDENCE_SCORE) {
      return {
        sport: best.sport,
        league: best.league,
        extraKeyword: best.extraKeyword,
        confidence: bestScore,
      };
    }
    return null;
  }

  function normalize(str) {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildSportSafeQuery(originalQuery, sportInfo) {
    if (!sportInfo) return originalQuery;
    const q = originalQuery.toLowerCase();
    if (q.includes(sportInfo.extraKeyword.toLowerCase())) return originalQuery;
    return `${originalQuery} ${sportInfo.extraKeyword}`;
  }

  // ===== Chặn query có chủ đề stadium/venue =====
  const STADIUM_KEYWORDS =
    /\b(stadium|oval|ground|arena|venue|cricket ground|mcg|home field|training ground)\b/i;

  // ===== Chặn query có chủ đề logo/crest/emblem — KHÔNG CHẤP NHẬN LOGO =====
  const LOGO_KEYWORDS =
    /\b(logo|crest|emblem|badge|insignia|symbol|die cut sticker)\b/i;

  function buildFallbackQuery(team, sportInfo) {
    const cleanTeam = (team || '')
      .replace(/\b(man|afl|nrl|nfl|ncaa|nba|wnba|nhl|mlb)\b/gi, '')
      .trim();
    const base = cleanTeam ? `${cleanTeam} players` : 'team players';
    return sportInfo
      ? `${base} on field ${sportInfo.extraKeyword}`
      : `${base} on field action photo`;
  }

  // ===== Sinh nhiều biến thể query cho cùng 1 placeholder để đa dạng kết quả ảnh =====
  const NUM_QUERY_VARIANTS = 1;

  const PHRASING_VARIANTS = [
    (q) => q,
    (q) => `${q} close up photo`,
    (q) => `${q} action shot`,
    (q) => `${q} on the field`,
    (q) => `${q} match day`,
  ];

  function buildQueryVariants(baseQuery, sportInfo, numVariants) {
    const variants = [];
    for (let i = 0; i < numVariants; i++) {
      const phraseFn = PHRASING_VARIANTS[i % PHRASING_VARIANTS.length];
      const variedRaw = phraseFn(baseQuery);
      const safeQuery = buildSportSafeQuery(variedRaw, sportInfo);
      variants.push({ rawQuery: variedRaw, query: safeQuery, variantIndex: i });
    }
    return variants;
  }

  for (const input of allInputs) {
    const item = input.json;
    const content = item.content || '';
    const rawTeam = item.team || item.sportTeam || '';

    if (item.error || !content) {
      results.push({
        json: {
          placeholder: null,
          query: null,
          index: null,
          originalContent: content,
          title: item.title || '',
          caption: item.caption || '',
          team: rawTeam,
          sport: null,
          league: null,
          error: item.error || 'Empty content',
        },
      });
      continue;
    }

    const fullText = `${rawTeam} ${item.title} ${item.caption} ${content}`;
    const sportInfo = detectSport(fullText);

    const regex = /<!--IMAGE:\s*(.*?)-->/g;
    let match;
    let index = 0;
    while ((match = regex.exec(content)) !== null) {
      const rawQuery = match[1].trim();

      const isStadiumQuery = STADIUM_KEYWORDS.test(rawQuery);
      const isLogoQuery = LOGO_KEYWORDS.test(rawQuery);
      const needsFallback = isStadiumQuery || isLogoQuery;

      const baseRawQuery = needsFallback
        ? buildFallbackQuery(rawTeam, sportInfo)
        : rawQuery;

      const variants = buildQueryVariants(
        baseRawQuery,
        sportInfo,
        NUM_QUERY_VARIANTS,
      );

      for (const variant of variants) {
        results.push({
          json: {
            placeholder: match[0],
            query: variant.query,
            rawQuery: variant.rawQuery,
            originalRawQuery: rawQuery,
            variantIndex: variant.variantIndex,
            wasStadiumQuery: isStadiumQuery,
            wasLogoQuery: isLogoQuery,
            index: index,
            originalContent: content,
            title: item.title,
            caption: item.caption,
            team: rawTeam,
            sport: sportInfo ? sportInfo.sport : null,
            league: sportInfo ? sportInfo.league : null,
            sportConfidence: sportInfo ? sportInfo.confidence : 0,
            error: null,
          },
        });
      }

      index++;
    }
  }

  return results;
}
