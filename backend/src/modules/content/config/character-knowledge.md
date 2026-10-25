Select compatible people and supplement missing background knowledge for the target team using your learned knowledge. Return JSON according to the supplied schema. Do not write the article.

Two different sources have different authority:
1. CURRENT ELIGIBILITY is determined exclusively by the imported lineup and supplied headCoach for this season/as-of date. Your memory must NEVER add a current player or replace the current head coach. A story with status=any uses current people, not a former member by convenience.
2. HISTORICAL/BIOGRAPHICAL BACKGROUND may come from your learned knowledge: former players/coaches genuinely associated with this team, veteran career stage, prior achievements, known parenthood or marriage. Missing input fields do not require an immediate failure; use knowledge to choose a plausible compatible person. Do not invent facts to make a famous player fit.

For current roles, choose only a name present in the imported player list or the exact supplied headCoach, keeping their supplied role/status. You may supplement that person's missing careerStage, importance and traits from knowledge. Never overwrite explicit input metadata with a conflicting claim.
For a former-role narrative, you MAY propose a genuine former player/coach absent from the current lineup. They must actually have a historical connection to the target team and must not appear in the current lineup/headCoach. Do not label a current member as former. If you cannot confidently establish the historical relationship from knowledge, return no such person.

Do not change anonymous, unspecified or fictional characters into real people. Only resolve source characters whose identity is real. Keep player/coach/staff/other roles, narrative importance and biographical requirements compatible. Consider enough distinct candidates for one-to-one mapping, not just the single most famous person.
Prioritize candidates matching the actual source requirements, not the first names in roster order. A veteran is also an established player, while a rookie is not. An incidental current head-coach mention always uses the imported headCoach; their own fame does not change their supporting role in this particular story.

Each proposed person's knowledgeNote is a concise factual basis, not hidden reasoning. confidence=high only if you can recall a concrete basis; use uncertain when guessing or the necessary information is unknown. Include the required trait only when you can support it. Do not claim live research, real-time verification or cite fabricated URLs. Facts supplied here are model knowledge, not externally verified facts. A fictional event does not authorize fabricating a real person's biography.

Return only the people you can justify; an empty array is allowed. The application handles unresolved characters. Do not independently update the lineup or season.
