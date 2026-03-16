import { createClient } from '@supabase/supabase-js';

// הגדרת קליינטים עם משתני סביבה בורסל
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  // הגדרת CORS כדי שגיטהאב יוכל לדבר עם ורסל
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Missing query' });

  const cleanQuery = query.toLowerCase().trim();

  try {
    // 1. בדיקה במטמון (Cache) בסופבס
    let { data: cacheData } = await supabase
      .from('search_vector_cache')
      .select('embedding')
      .eq('query_text', cleanQuery)
      .single();

    let vector;

    if (cacheData) {
      vector = cacheData.embedding;
    } else {
      // 2. יצירת ווקטור ב-Hugging Face (כי אין במטמון)
      const hfResponse = await fetch(
        "https://router.huggingface.co/hf-inference/models/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        {
          headers: { 
            "Authorization": `Bearer ${process.env.HF_TOKEN}`, 
            "Content-Type": "application/json",
            "X-Wait-For-Model": "true"
          },
          method: "POST",
          body: JSON.stringify({ inputs: [cleanQuery] }),
        }
      );

      const result = await hfResponse.json();
      
      // שליפת הווקטור מהמבנה של הראוטר
      vector = Array.isArray(result[0]) ? (Array.isArray(result[0][0]) ? result[0][0] : result[0]) : result;

      if (vector && Array.isArray(vector)) {
        // 3. שמירה במטמון לפעם הבאה (אסינכרוני)
        supabase.from('search_vector_cache').insert({ 
            query_text: cleanQuery, 
            embedding: vector 
        }).then();
      }
    }

    // 4. הרצת החיפוש ההיברידי בסופבס
    const { data: results, error } = await supabase.rpc('search_videos_hybrid_v2', {
      search_term: cleanQuery,
      search_vector: vector
    });

    if (error) throw error;
    
    return res.status(200).json(results);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}