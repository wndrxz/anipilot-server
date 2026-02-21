const GROQ = "https://api.groq.com/openai/v1/chat/completions";
const KEY = process.env.GROQ_KEY;
const cache = new Map();

const SYS = `Ты эксперт по аниме. Определи аниме по описанию/названию.
JSON: {"found":true,"title_ru":"","title_en":"","search_queries":[""],"confidence":95,"desc":""}
Или: {"found":false,"suggestions":[""]}
ТОЛЬКО JSON.`;

module.exports = {
  async ask(query, model = "llama-3.3-70b-versatile") {
    const key = `${model}:${query}`;
    if (cache.has(key)) return cache.get(key);

    const r = await fetch(GROQ, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYS },
          { role: "user", content: query },
        ],
        temperature: 0.2,
        max_tokens: 400,
      }),
    });

    const d = await r.json();
    if (d.error) throw new Error(d.error.message || "Groq error");

    const txt = d.choices?.[0]?.message?.content?.trim();
    if (!txt) throw new Error("Empty AI response");

    let result;
    try {
      result = JSON.parse(txt);
    } catch {
      const m = txt.match(/\{[\s\S]*\}/);
      result = m ? JSON.parse(m[0]) : null;
    }
    if (!result) throw new Error("Bad AI JSON");

    cache.set(key, result);
    if (cache.size > 300) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
    return result;
  },

  async recommend(history) {
    if (!history || history.length < 2) {
      throw new Error("Need at least 2 watched anime");
    }

    const titles = history
      .slice(0, 10)
      .map((h) => `${h.title}${h.genres ? " (" + h.genres + ")" : ""}`)
      .join(", ");

    const prompt = `Пользователь смотрел эти аниме: ${titles}.

Порекомендуй 5 похожих аниме которые ему понравятся. Учитывай жанры, стиль, атмосферу.
Не рекомендуй то что он уже смотрел.

JSON: {"recs":[{"title_ru":"название на русском","title_en":"название на английском","reason":"короткое объяснение в 1 предложение почему понравится","query":"запрос для поиска на русском"}]}
ТОЛЬКО JSON, без пояснений.`;

    const r = await fetch(GROQ, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
        max_tokens: 700,
      }),
    });

    const d = await r.json();
    if (d.error) throw new Error(d.error.message || "Groq error");

    const txt = d.choices?.[0]?.message?.content?.trim() || "";
    if (!txt) throw new Error("Empty recommendation response");

    let j;
    try {
      j = JSON.parse(txt);
    } catch {
      const m = txt.match(/\{[\s\S]*\}/);
      j = m ? JSON.parse(m[0]) : null;
    }
    if (!j?.recs || !Array.isArray(j.recs)) {
      throw new Error("Bad recommendation JSON");
    }

    return j.recs.slice(0, 5);
  },
};
