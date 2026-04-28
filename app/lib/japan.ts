// Maps Japanese city / region names → prefecture flag.
// Flags are cached locally under public/flags/<key>.svg (originally pulled
// from Wikimedia Commons, see scripts/fetch-flags.mjs).

const PREFECTURE_FLAG_FILES: Record<string, string> = {
  hokkaido: "Flag_of_Hokkaido_Prefecture.svg",
  aomori: "Flag_of_Aomori_Prefecture.svg",
  iwate: "Flag_of_Iwate_Prefecture.svg",
  miyagi: "Flag_of_Miyagi_Prefecture.svg",
  akita: "Flag_of_Akita_Prefecture.svg",
  yamagata: "Flag_of_Yamagata_Prefecture.svg",
  fukushima: "Flag_of_Fukushima_Prefecture.svg",
  ibaraki: "Flag_of_Ibaraki_Prefecture.svg",
  tochigi: "Flag_of_Tochigi_Prefecture.svg",
  gunma: "Flag_of_Gunma_Prefecture.svg",
  saitama: "Flag_of_Saitama_Prefecture.svg",
  chiba: "Flag_of_Chiba_Prefecture.svg",
  tokyo: "Flag_of_Tokyo_Metropolis.svg",
  kanagawa: "Flag_of_Kanagawa_Prefecture.svg",
  niigata: "Flag_of_Niigata_Prefecture.svg",
  toyama: "Flag_of_Toyama_Prefecture.svg",
  ishikawa: "Flag_of_Ishikawa_Prefecture.svg",
  fukui: "Flag_of_Fukui_Prefecture.svg",
  yamanashi: "Flag_of_Yamanashi_Prefecture.svg",
  nagano: "Flag_of_Nagano_Prefecture.svg",
  gifu: "Flag_of_Gifu_Prefecture.svg",
  shizuoka: "Flag_of_Shizuoka_Prefecture.svg",
  aichi: "Flag_of_Aichi_Prefecture.svg",
  mie: "Flag_of_Mie_Prefecture.svg",
  shiga: "Flag_of_Shiga_Prefecture.svg",
  kyoto: "Flag_of_Kyoto_Prefecture.svg",
  osaka: "Flag_of_Osaka_Prefecture.svg",
  hyogo: "Flag_of_Hyogo_Prefecture.svg",
  nara: "Flag_of_Nara_Prefecture.svg",
  wakayama: "Flag_of_Wakayama_Prefecture.svg",
  tottori: "Flag_of_Tottori_Prefecture.svg",
  shimane: "Flag_of_Shimane_Prefecture.svg",
  okayama: "Flag_of_Okayama_Prefecture.svg",
  hiroshima: "Flag_of_Hiroshima_Prefecture.svg",
  yamaguchi: "Flag_of_Yamaguchi_Prefecture.svg",
  tokushima: "Flag_of_Tokushima_Prefecture.svg",
  kagawa: "Flag_of_Kagawa_Prefecture.svg",
  ehime: "Flag_of_Ehime_Prefecture.svg",
  kochi: "Flag_of_Kochi_Prefecture.svg",
  fukuoka: "Flag_of_Fukuoka_Prefecture.svg",
  saga: "Flag_of_Saga_Prefecture.svg",
  nagasaki: "Flag_of_Nagasaki_Prefecture.svg",
  kumamoto: "Flag_of_Kumamoto_Prefecture.svg",
  oita: "Flag_of_Oita_Prefecture.svg",
  miyazaki: "Flag_of_Miyazaki_Prefecture.svg",
  kagoshima: "Flag_of_Kagoshima_Prefecture.svg",
  okinawa: "Flag_of_Okinawa_Prefecture.svg",
};

// City / area aliases → prefecture key
const CITY_TO_PREFECTURE: Record<string, string> = {
  // Hokkaido
  sapporo: "hokkaido", hakodate: "hokkaido", otaru: "hokkaido", niseko: "hokkaido",
  // Tohoku
  sendai: "miyagi", matsushima: "miyagi",
  morioka: "iwate", hiraizumi: "iwate",
  hirosaki: "aomori",
  // Kanto
  yokohama: "kanagawa", kawasaki: "kanagawa", kamakura: "kanagawa", hakone: "kanagawa", "yokosuka": "kanagawa",
  nikko: "tochigi",
  narita: "chiba",
  // Chubu
  nagoya: "aichi",
  fuji: "shizuoka", "mt fuji": "shizuoka", "mount fuji": "shizuoka", hamamatsu: "shizuoka", atami: "shizuoka",
  takayama: "gifu", "shirakawa-go": "gifu", shirakawago: "gifu",
  matsumoto: "nagano", karuizawa: "nagano", nozawa: "nagano",
  kanazawa: "ishikawa",
  // Kansai
  kobe: "hyogo", himeji: "hyogo",
  ise: "mie",
  koyasan: "wakayama", "mount koya": "wakayama",
  // Chugoku
  miyajima: "hiroshima", itsukushima: "hiroshima", onomichi: "hiroshima", kure: "hiroshima",
  kurashiki: "okayama",
  izumo: "shimane", matsue: "shimane",
  // Shikoku
  takamatsu: "kagawa", naoshima: "kagawa",
  matsuyama: "ehime",
  // Kyushu
  hakata: "fukuoka", kitakyushu: "fukuoka", "kita-kyushu": "fukuoka", dazaifu: "fukuoka",
  beppu: "oita", yufuin: "oita",
  // Okinawa
  naha: "okinawa", ishigaki: "okinawa",
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[,\.()!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findPrefectureKey(name: string): string | null {
  if (!name) return null;
  const n = normalize(name);
  if (!n) return null;

  // Direct prefecture match
  if (PREFECTURE_FLAG_FILES[n]) return n;
  // Direct city alias
  if (CITY_TO_PREFECTURE[n]) return CITY_TO_PREFECTURE[n];

  // Token match (e.g. "Tokyo, Japan" → tokyo)
  const tokens = n.split(" ");
  for (const t of tokens) {
    if (PREFECTURE_FLAG_FILES[t]) return t;
    if (CITY_TO_PREFECTURE[t]) return CITY_TO_PREFECTURE[t];
  }

  // Substring scan over known keys (e.g. "tokyobay" → tokyo)
  for (const key of Object.keys(PREFECTURE_FLAG_FILES)) {
    if (n.includes(key)) return key;
  }
  for (const alias of Object.keys(CITY_TO_PREFECTURE)) {
    if (n.includes(alias)) return CITY_TO_PREFECTURE[alias];
  }
  return null;
}

export function flagUrl(prefectureKey: string, _width = 48): string {
  if (!PREFECTURE_FLAG_FILES[prefectureKey]) return "";
  return `/flags/${prefectureKey}.svg`;
}

export function flagForLocation(name: string, width = 48): string | null {
  const key = findPrefectureKey(name);
  if (!key) return null;
  return flagUrl(key, width);
}

export function prefectureNameFor(name: string): string | null {
  const key = findPrefectureKey(name);
  if (!key) return null;
  // Capitalize for display
  return key.charAt(0).toUpperCase() + key.slice(1);
}
