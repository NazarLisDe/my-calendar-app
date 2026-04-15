// Auto-generated Vercel proxy -> Supabase do-patch EF
export default async function handler(req, res) {
  try {
    const r = await fetch('https://mexvcooxruzxrntvhzmc.supabase.co/functions/v1/do-patch', { method: 'GET' });
    const d = await r.json();
    res.status(200).json(d);
  } catch(e) { res.status(500).json({ error: String(e) }); }
}
