/**
 * Curated generated cover library for travel-oriented, non-evidentiary surfaces.
 *
 * These images are decorative. A real browser screenshot or a sourced POI image must take
 * priority when one exists; this catalog is the honest fallback for welcome-screen cards.
 * Every entry points at an optimized project asset and keeps enough generation metadata to
 * be regenerated or replaced without changing the selection API.
 */

export type TravelCoverKind = "destination" | "activity" | "season" | "generic";
export type TravelCoverTone = "dark" | "cool" | "warm" | "light";

export interface TravelCoverAsset {
  id: string;
  src: string;
  kind: TravelCoverKind;
  subject: string;
  tags: readonly string[];
  keywords: readonly string[];
  seasons: readonly ("spring" | "summer" | "autumn" | "winter" | "all")[];
  tone: TravelCoverTone;
  /** CSS object-position tuned for the card crop. */
  focalPoint: string;
  source: "generated";
  promptVersion: 1;
}

const cover = (
  id: string,
  kind: TravelCoverKind,
  subject: string,
  tags: readonly string[],
  keywords: readonly string[],
  seasons: TravelCoverAsset["seasons"],
  tone: TravelCoverTone,
  focalPoint = "50% 50%",
): TravelCoverAsset => ({
  id,
  src: `/travel-covers/${id}.jpg`,
  kind,
  subject,
  tags,
  keywords,
  seasons,
  tone,
  focalPoint,
  source: "generated",
  promptVersion: 1,
});

export const TRAVEL_COVER_CATALOG: readonly TravelCoverAsset[] = [
  // 24 destination scenes.
  cover(
    "tokyo-night",
    "destination",
    "Tokyo at blue hour",
    ["asia", "japan", "city", "night", "culture"],
    ["tokyo", "东京", "東京"],
    ["all"],
    "dark",
    "50% 43%",
  ),
  cover(
    "kyoto-temple",
    "destination",
    "Kyoto temple lane",
    ["asia", "japan", "temple", "culture", "autumn"],
    ["kyoto", "京都"],
    ["autumn", "all"],
    "warm",
    "50% 45%",
  ),
  cover(
    "seoul-rooftops",
    "destination",
    "Seoul rooftops at dusk",
    ["asia", "korea", "city", "culture", "night"],
    ["seoul", "korea", "首尔", "首爾", "韩国", "韓國"],
    ["all"],
    "cool",
    "50% 42%",
  ),
  cover(
    "bangkok-river",
    "destination",
    "Bangkok river at golden hour",
    ["asia", "thailand", "river", "city", "temple"],
    ["bangkok", "thailand", "曼谷", "泰国", "泰國"],
    ["all"],
    "warm",
    "50% 44%",
  ),
  cover(
    "singapore-gardens",
    "destination",
    "Singapore tropical city gardens",
    ["asia", "singapore", "city", "garden", "tropical"],
    ["singapore", "新加坡", "狮城", "獅城"],
    ["all"],
    "cool",
    "50% 45%",
  ),
  cover(
    "bali-rice",
    "destination",
    "Bali rice terraces",
    ["asia", "indonesia", "island", "nature", "tropical"],
    ["bali", "indonesia", "巴厘", "巴釐", "印度尼西亚", "印尼"],
    ["all"],
    "light",
    "50% 44%",
  ),
  cover(
    "paris-rooftops",
    "destination",
    "Paris rooftops at blue hour",
    ["europe", "france", "city", "romantic", "culture"],
    ["paris", "france", "巴黎", "法国", "法國"],
    ["all"],
    "cool",
    "50% 40%",
  ),
  cover(
    "rome-street",
    "destination",
    "Roman cobblestone street",
    ["europe", "italy", "city", "history", "food"],
    ["rome", "italy", "罗马", "羅馬", "意大利", "義大利"],
    ["all"],
    "warm",
    "50% 45%",
  ),
  cover(
    "barcelona-coast",
    "destination",
    "Barcelona waterfront",
    ["europe", "spain", "city", "coast", "food"],
    ["barcelona", "spain", "巴塞罗那", "巴塞羅那", "西班牙"],
    ["spring", "summer", "autumn"],
    "light",
    "50% 43%",
  ),
  cover(
    "amsterdam-canals",
    "destination",
    "Amsterdam canal houses",
    ["europe", "netherlands", "city", "canal", "culture"],
    ["amsterdam", "netherlands", "阿姆斯特丹", "荷兰", "荷蘭"],
    ["all"],
    "cool",
    "50% 43%",
  ),
  cover(
    "swiss-alps",
    "destination",
    "Swiss alpine lake and cabin",
    ["europe", "switzerland", "mountain", "lake", "nature"],
    ["swiss", "switzerland", "alps", "瑞士", "阿尔卑斯", "阿爾卑斯"],
    ["all"],
    "cool",
    "55% 43%",
  ),
  cover(
    "greek-island",
    "destination",
    "Greek island coast",
    ["europe", "greece", "island", "coast", "summer"],
    ["greece", "greek", "santorini", "希腊", "希臘", "圣托里尼", "聖托里尼"],
    ["spring", "summer", "autumn"],
    "light",
    "50% 42%",
  ),
  cover(
    "new-york-rooftop",
    "destination",
    "New York rooftop skyline",
    ["americas", "usa", "city", "skyline", "night"],
    ["new york", "nyc", "manhattan", "纽约", "紐約", "曼哈顿", "曼哈頓"],
    ["all"],
    "dark",
    "50% 42%",
  ),
  cover(
    "san-francisco-bay",
    "destination",
    "San Francisco Bay",
    ["americas", "usa", "city", "coast", "road"],
    ["san francisco", "sf", "旧金山", "舊金山", "三藩市"],
    ["all"],
    "cool",
    "50% 43%",
  ),
  cover(
    "quebec-winter",
    "destination",
    "Old Quebec in winter",
    ["americas", "canada", "city", "snow", "history"],
    ["quebec", "canada", "魁北克", "加拿大"],
    ["winter"],
    "cool",
    "50% 45%",
  ),
  cover(
    "patagonia-lake",
    "destination",
    "Patagonia mountain lake",
    ["americas", "argentina", "chile", "mountain", "hiking"],
    ["patagonia", "argentina", "chile", "巴塔哥尼亚", "巴塔哥尼亞", "阿根廷", "智利"],
    ["spring", "summer", "autumn"],
    "cool",
    "50% 42%",
  ),
  cover(
    "marrakech-courtyard",
    "destination",
    "Marrakech riad courtyard",
    ["africa", "morocco", "city", "culture", "architecture"],
    ["marrakech", "morocco", "马拉喀什", "馬拉喀什", "摩洛哥"],
    ["all"],
    "warm",
    "50% 48%",
  ),
  cover(
    "cape-town-coast",
    "destination",
    "Cape Town coast",
    ["africa", "south-africa", "coast", "mountain", "road"],
    ["cape town", "south africa", "开普敦", "開普敦", "南非"],
    ["all"],
    "cool",
    "50% 42%",
  ),
  cover(
    "dubai-desert",
    "destination",
    "Dubai desert retreat",
    ["middle-east", "uae", "desert", "city", "luxury"],
    ["dubai", "uae", "迪拜", "杜拜", "阿联酋", "阿聯酋"],
    ["autumn", "winter", "spring"],
    "warm",
    "50% 44%",
  ),
  cover(
    "sydney-harbour",
    "destination",
    "Sydney harbour morning",
    ["oceania", "australia", "city", "harbour", "coast"],
    ["sydney", "australia", "悉尼", "雪梨", "澳大利亚", "澳洲"],
    ["all"],
    "light",
    "50% 41%",
  ),
  cover(
    "new-zealand-fjord",
    "destination",
    "New Zealand fjord",
    ["oceania", "new-zealand", "fjord", "mountain", "nature"],
    ["new zealand", "milford", "queenstown", "新西兰", "紐西蘭", "皇后镇", "皇后鎮"],
    ["all"],
    "cool",
    "50% 42%",
  ),
  cover(
    "shanghai-night",
    "destination",
    "Shanghai waterfront at night",
    ["asia", "china", "city", "skyline", "night"],
    ["shanghai", "上海", "外滩", "外灘"],
    ["all"],
    "dark",
    "50% 40%",
  ),
  cover(
    "hangzhou-west-lake",
    "destination",
    "Hangzhou West Lake",
    ["asia", "china", "lake", "garden", "culture"],
    ["hangzhou", "west lake", "杭州", "西湖"],
    ["all"],
    "cool",
    "50% 43%",
  ),
  cover(
    "yunnan-old-town",
    "destination",
    "Yunnan old town",
    ["asia", "china", "mountain", "culture", "old-town"],
    ["yunnan", "lijiang", "dali", "云南", "雲南", "丽江", "麗江", "大理"],
    ["all"],
    "warm",
    "50% 44%",
  ),

  // 12 activity scenes.
  cover(
    "flight-window",
    "activity",
    "View from an airplane window",
    ["transport", "flight", "sky"],
    [
      "flight",
      "airline",
      "plane",
      "airport",
      "航班",
      "机票",
      "機票",
      "飞机",
      "飛機",
      "机场",
      "機場",
    ],
    ["all"],
    "cool",
    "50% 45%",
  ),
  cover(
    "train-journey",
    "activity",
    "Scenic train journey",
    ["transport", "train", "landscape"],
    ["train", "rail", "铁路", "鐵路", "火车", "火車", "高铁", "高鐵"],
    ["all"],
    "warm",
    "50% 44%",
  ),
  cover(
    "road-trip",
    "activity",
    "Open-road journey",
    ["transport", "car", "road", "landscape"],
    ["road trip", "drive", "rental car", "自驾", "自駕", "租车", "租車", "公路"],
    ["all"],
    "warm",
    "50% 45%",
  ),
  cover(
    "city-walk",
    "activity",
    "Neighbourhood city walk",
    ["city", "walking", "architecture", "slow-travel"],
    ["city walk", "walking", "neighbourhood", "neighborhood", "街区", "街區", "漫步", "步行"],
    ["all"],
    "warm",
    "50% 44%",
  ),
  cover(
    "food-market",
    "activity",
    "Local food market",
    ["food", "market", "culture"],
    ["food", "restaurant", "market", "dining", "美食", "餐厅", "餐廳", "市场", "市場", "吃"],
    ["all"],
    "warm",
    "50% 45%",
  ),
  cover(
    "museum-day",
    "activity",
    "Modern museum interior",
    ["culture", "museum", "architecture"],
    [
      "museum",
      "gallery",
      "exhibition",
      "art",
      "博物馆",
      "博物館",
      "美术馆",
      "美術館",
      "展览",
      "展覽",
    ],
    ["all"],
    "light",
    "50% 45%",
  ),
  cover(
    "beach-day",
    "activity",
    "Quiet tropical beach",
    ["beach", "coast", "relax", "summer"],
    ["beach", "island", "seaside", "海滩", "海灘", "海岛", "海島", "海边", "海邊"],
    ["summer", "all"],
    "light",
    "50% 43%",
  ),
  cover(
    "hiking-trail",
    "activity",
    "Mountain hiking trail",
    ["hiking", "mountain", "nature", "outdoor"],
    ["hike", "hiking", "trek", "trail", "徒步", "登山", "远足", "遠足"],
    ["spring", "summer", "autumn"],
    "cool",
    "50% 42%",
  ),
  cover(
    "skiing-morning",
    "activity",
    "Alpine skiing morning",
    ["ski", "snow", "mountain", "winter"],
    ["ski", "skiing", "snowboard", "滑雪", "雪场", "雪場"],
    ["winter"],
    "cool",
    "50% 42%",
  ),
  cover(
    "hot-spring",
    "activity",
    "Open-air hot spring",
    ["wellness", "hot-spring", "nature", "relax"],
    ["hot spring", "onsen", "spa", "温泉", "汤泉", "湯泉"],
    ["autumn", "winter", "spring"],
    "warm",
    "50% 46%",
  ),
  cover(
    "family-trip",
    "activity",
    "Family exploring a waterfront",
    ["family", "walking", "city", "coast"],
    ["family", "kids", "children", "亲子", "親子", "家庭", "孩子", "儿童", "兒童"],
    ["all"],
    "light",
    "50% 43%",
  ),
  cover(
    "romantic-dinner",
    "activity",
    "Intimate terrace dinner",
    ["romantic", "food", "night", "couple"],
    [
      "romantic",
      "honeymoon",
      "anniversary",
      "couple",
      "浪漫",
      "蜜月",
      "纪念日",
      "紀念日",
      "情侣",
      "情侶",
    ],
    ["all"],
    "dark",
    "50% 44%",
  ),

  // 8 season and weather scenes.
  cover(
    "spring-blossoms",
    "season",
    "Spring blossoms beside a river",
    ["spring", "blossom", "nature"],
    ["spring", "blossom", "cherry", "春天", "春季", "樱花", "櫻花", "花季"],
    ["spring"],
    "light",
    "50% 42%",
  ),
  cover(
    "summer-sunrise",
    "season",
    "Summer coastal sunrise",
    ["summer", "coast", "sunrise"],
    ["summer", "sunrise", "暑假", "夏天", "夏季", "日出"],
    ["summer"],
    "warm",
    "50% 40%",
  ),
  cover(
    "autumn-forest",
    "season",
    "Autumn forest road",
    ["autumn", "forest", "road"],
    ["autumn", "fall foliage", "秋天", "秋季", "红叶", "紅葉", "枫叶", "楓葉"],
    ["autumn"],
    "warm",
    "50% 43%",
  ),
  cover(
    "winter-cabin",
    "season",
    "Winter cabin in fresh snow",
    ["winter", "snow", "cabin", "mountain"],
    ["winter", "snow", "冬天", "冬季", "雪", "木屋"],
    ["winter"],
    "cool",
    "55% 44%",
  ),
  cover(
    "rainy-city",
    "season",
    "Rainy city evening",
    ["rain", "city", "night", "weather"],
    ["rain", "rainy", "monsoon", "下雨", "雨天", "雨季"],
    ["all"],
    "dark",
    "50% 44%",
  ),
  cover(
    "snowy-town",
    "season",
    "Snowy mountain town",
    ["snow", "town", "winter", "night"],
    ["snowy town", "snow village", "雪乡", "雪鄉", "雪镇", "雪鎮"],
    ["winter"],
    "cool",
    "50% 43%",
  ),
  cover(
    "desert-golden-hour",
    "season",
    "Desert at golden hour",
    ["desert", "sunset", "warm", "weather"],
    ["desert", "dunes", "沙漠", "沙丘", "戈壁"],
    ["autumn", "winter", "spring"],
    "warm",
    "50% 42%",
  ),
  cover(
    "northern-lights",
    "season",
    "Northern lights over a lake",
    ["aurora", "night", "winter", "nature"],
    ["aurora", "northern lights", "极光", "極光"],
    ["autumn", "winter", "spring"],
    "dark",
    "50% 38%",
  ),

  // 4 neutral fallbacks. Unknown titles only draw from this group.
  cover(
    "packed-suitcase",
    "generic",
    "Packed suitcase by a window",
    ["travel", "luggage", "planning"],
    [],
    ["all"],
    "warm",
    "50% 47%",
  ),
  cover(
    "travel-journal",
    "generic",
    "Travel journal and camera",
    ["travel", "planning", "journal"],
    [],
    ["all"],
    "light",
    "50% 48%",
  ),
  cover(
    "airport-terminal",
    "generic",
    "Quiet airport terminal",
    ["travel", "airport", "departure"],
    [],
    ["all"],
    "cool",
    "50% 44%",
  ),
  cover(
    "open-road",
    "generic",
    "Open road toward distant mountains",
    ["travel", "road", "possibility"],
    [],
    ["all"],
    "warm",
    "50% 43%",
  ),
] as const;

export interface TravelCoverSubject {
  sessionId: string;
  title?: string | null;
  /** Optional future intent summary or destination hint. */
  hint?: string | null;
}

export interface TravelCoverSelectionOptions {
  /** Covers reserved by another visible surface, such as the Get inspired rail. */
  excludedIds?: ReadonlySet<string>;
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function semanticScore(asset: TravelCoverAsset, text: string): number {
  let score = 0;
  for (const keyword of asset.keywords) {
    const term = normalized(keyword);
    // Latin keywords use token boundaries ("art" must not match "depart"). CJK terms
    // normally have no spaces between words, so substring matching is the useful boundary.
    const matches =
      term.length > 0 &&
      (/[^\x00-\x7F]/.test(term) ? text.includes(term) : ` ${text} `.includes(` ${term} `));
    if (matches) score += 100 + term.length;
  }
  if (score === 0) return 0;
  // An explicit activity is the strongest visual intent ("flights to Shanghai" should
  // look like a flight, not a guessed Shanghai city break). A named destination then
  // outranks seasonal atmosphere ("Kyoto autumn" should still look like Kyoto).
  return score + (asset.kind === "activity" ? 2_000 : asset.kind === "destination" ? 1_000 : 0);
}

/** Stable unsigned hash used only as a deterministic tie-breaker. */
function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Selects one cover per visible Session.
 *
 * Explicit semantic matches win. If no destination/activity/season can be inferred, only
 * generic images are eligible, preventing a greeting or coding Session from being labelled
 * with the wrong city. Covers reserved by another visible rail are removed before matching.
 * Within each candidate set, the Session id provides a stable order and already-used covers
 * move to the back so adjacent cards do not repeat where alternatives exist.
 */
export function selectTravelCovers(
  subjects: readonly TravelCoverSubject[],
  catalog: readonly TravelCoverAsset[] = TRAVEL_COVER_CATALOG,
  options: TravelCoverSelectionOptions = {},
): TravelCoverAsset[] {
  const availableCatalog = catalog.filter((asset) => !options.excludedIds?.has(asset.id));
  const fallback = availableCatalog[0];
  if (!fallback) throw new Error("No travel covers are available");

  const used = new Set<string>();
  return subjects.map((subject) => {
    const text = normalized(`${subject.title ?? ""} ${subject.hint ?? ""}`);
    const scored = availableCatalog
      .map((asset) => ({ asset, score: semanticScore(asset, text) }))
      .filter(({ score }) => score > 0);
    const candidates = scored.length
      ? scored
      : availableCatalog
          .filter((asset) => asset.kind === "generic")
          .map((asset) => ({ asset, score: 0 }));
    const ranked = [...candidates].sort(
      (a, b) =>
        Number(used.has(a.asset.id)) - Number(used.has(b.asset.id)) ||
        b.score - a.score ||
        stableHash(`${subject.sessionId}:${a.asset.id}`) -
          stableHash(`${subject.sessionId}:${b.asset.id}`),
    );
    const selected = ranked[0]?.asset ?? fallback;
    used.add(selected.id);
    return selected;
  });
}
