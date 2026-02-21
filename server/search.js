const API = "https://api.whitewhale.help";
const SITE = "https://animix.lol";

const Search = {
  thumb: (id) => `${API}/anime/getThumb/${id}_thumb.png`,
  url: (id) => `${SITE}/anime/${id}`,

  async search(queries) {
    const all = [],
      seen = new Set();

    for (const q of queries) {
      if (!q || q.length < 2) continue;
      try {
        const r = await fetch(
          `${API}/search/searchFiltered?page=0&query=${encodeURIComponent(q)}`,
        );
        const d = await r.json();
        if (d?.type === "success" && d.data?.anime) {
          for (const a of d.data.anime) {
            if (seen.has(a.id)) continue;
            seen.add(a.id);
            all.push({
              id: a.id,
              title: a.name,
              genres: a.genres || [],
              studio: a.studio || "",
              rating: a.rating || 0,
              viral: a.viral || 0,
              image: Search.thumb(a.id),
              url: Search.url(a.id),
            });
          }
        }
        if (all.length >= 8) break;
      } catch (e) {
        console.warn("[Search]", e.message);
      }
    }

    all.sort((a, b) => b.viral - a.viral);
    return all.slice(0, 10);
  },

  async random() {
    try {
      const r = await fetch(
        `${API}/search/searchFiltered?page=${Math.floor(Math.random() * 50)}`,
      );
      const d = await r.json();
      if (d?.type === "success" && d.data?.anime?.length) {
        const a = d.data.anime[Math.floor(Math.random() * d.data.anime.length)];
        return {
          id: a.id,
          title: a.name,
          genres: a.genres || [],
          studio: a.studio || "",
          rating: a.rating || 0,
          image: Search.thumb(a.id),
          url: Search.url(a.id),
        };
      }
    } catch {}
    return null;
  },
};

module.exports = Search;
