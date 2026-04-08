export default async function handler(req, res) {
  try {
    const r = await fetch('https://mexvcooxruzxrntvhzmc.supabase.co/functions/v1/deploy-cloud-appjs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await r.json();
    res.status(200).json(d);
  } catch (e) { res.status(500).json({ error: String(e) }); }
}
