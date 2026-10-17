// 유튜브 한국 인기 쇼츠 수집기
// 깃허브 Actions가 매일 실행해서 data/shorts.json 파일을 만들어요.
const fs = require("fs");

const KEY = process.env.YT_API_KEY;
if (!KEY) { console.error("YT_API_KEY가 없어요. 깃허브 Secrets에 등록했는지 확인하세요."); process.exit(1); }

const API = "https://www.googleapis.com/youtube/v3/";
const MAX_SEC = 180;   // 쇼츠 최대 길이(3분)
const KEEP = 100;      // 사이트에 보여줄 개수

async function get(path, params) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries({ ...params, key: KEY })) u.searchParams.set(k, v);
  const r = await fetch(u);
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j.error));
  return j;
}

function toSec(iso = "") {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

function pick(v, source) {
  const s = v.snippet, st = v.statistics || {};
  const t = s.thumbnails || {};
  return {
    id: v.id,
    title: s.title,
    channel: s.channelTitle,
    publishedAt: s.publishedAt,
    duration: toSec(v.contentDetails?.duration),
    views: +st.viewCount || 0,
    likes: +st.likeCount || 0,
    comments: +st.commentCount || 0,
    thumb: (t.high || t.medium || t.default || {}).url || "",
    source,
  };
}

async function main() {
  const all = new Map();

  // 1) 유튜브 한국 인기 동영상 차트 (최대 200개) 중 3분 이하
  let pageToken = "";
  for (let i = 0; i < 4; i++) {
    const j = await get("videos", {
      part: "snippet,contentDetails,statistics",
      chart: "mostPopular", regionCode: "KR", maxResults: 50,
      ...(pageToken && { pageToken }),
    });
    j.items.forEach(v => all.set(v.id, pick(v, "인기차트")));
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }

  // 2) 최근 3일 안에 올라온 한국어 짧은 영상 중 조회수 높은 순
  const since = new Date(Date.now() - 3 * 864e5).toISOString();
  const s = await get("search", {
    part: "id", type: "video", regionCode: "KR", relevanceLanguage: "ko",
    videoDuration: "short", order: "viewCount", publishedAfter: since, maxResults: 50,
  });
  const ids = s.items.map(x => x.id.videoId).filter(id => id && !all.has(id));
  if (ids.length) {
    const j = await get("videos", { part: "snippet,contentDetails,statistics", id: ids.join(",") });
    j.items.forEach(v => all.set(v.id, pick(v, "최근 급상승")));
  }

  const items = [...all.values()]
    .filter(v => v.duration > 0 && v.duration <= MAX_SEC)
    .sort((a, b) => b.views - a.views)
    .slice(0, KEEP);

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/shorts.json", JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 1));
  console.log(`쇼츠 ${items.length}개 저장 완료`);
}

main().catch(e => { console.error("수집 실패:", e.message); process.exit(1); });
