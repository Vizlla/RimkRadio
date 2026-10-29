// Build do Render (Static Site): copia os arquivos do site para dist/ e gera
// dist/supabase-config.json a partir das variáveis de ambiente.
// A chave "anon" do Supabase é pública por natureza; quem protege os dados é o RLS do banco.
const fs = require('fs');
const path = require('path');

const isHttp = (v) => /^https?:\/\//i.test(v);
const url = [process.env.SUPABASE_URL, process.env.SUPABASE_DATABASE_URL]
  .map((v) => (v || '').trim())
  .find(isHttp) || '';
const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim();

if (!url || !anonKey) {
  console.error('\nERRO: faltam variáveis de ambiente no Render.');
  console.error('Crie em Environment:');
  console.error('  SUPABASE_URL      = https://xxxx.supabase.co  (Project Settings > API > Project URL)');
  console.error('  SUPABASE_ANON_KEY = chave "anon public"        (Project Settings > API Keys)\n');
  process.exit(1);
}

const out = path.join(__dirname, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const f of ['index.html', 'script.js', 'avatar.js', 'profile.js', 'radio.js', 'feed.js', 'cinema.js', 'fullscreen.js', 'styles.css', 'tailwind-config.js', 'logo.png', 'logo-text.png', 'logo-zunk.svg', 'logo-alien.png', 'rimk-like.png', 'zunk-dislike.png']) {
  fs.copyFileSync(path.join(__dirname, f), path.join(out, f));
}
// Avatares: PNGs das camadas (alien, acessórios, fundos e ícones)
// Avatares: aceita as pastas dentro de avatar/ OU soltas na raiz do repositório (base, item, icon, bg)
for (const sub of ['base', 'item', 'bg']) {
  const src = [path.join(__dirname, 'avatar', sub), path.join(__dirname, sub)].find((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
  if (src) fs.cpSync(src, path.join(out, 'avatar', sub), { recursive: true });
  else console.warn('AVISO: pasta de avatar "' + sub + '" não encontrada no repositório (os avatares podem não aparecer).');
}
fs.writeFileSync(path.join(out, 'supabase-config.json'), JSON.stringify({ url, anonKey }));

// Chave da YouTube Data API (opcional): melhora busca, playlists e detecção de lives.
// Também é pública no navegador — restrinja por domínio (HTTP referrer) e só à YouTube Data API v3 no Google Cloud.
const ytKey = (process.env.YOUTUBE_API_KEY || '').trim();
if (ytKey) {
  fs.writeFileSync(path.join(out, 'youtube-config.json'), JSON.stringify({ key: ytKey }));
  console.log('Chave do YouTube: configurada.');
} else {
  console.log('Chave do YouTube: não configurada (opcional — defina YOUTUBE_API_KEY no Render para busca mais estável).');
}
// TURN opcional (cinema): sem ele, só funciona entre redes que conseguem conexão direta (STUN).
// Defina TURN_URLS (separe por vírgula, ex.: turn:meu.servidor:3478,turns:meu.servidor:5349), TURN_USERNAME e TURN_CREDENTIAL.
const turnUrls = (process.env.TURN_URLS || '').split(',').map((x) => x.trim()).filter((x) => /^turns?:/i.test(x));
if (turnUrls.length) {
  fs.writeFileSync(path.join(out, 'turn-config.json'), JSON.stringify({ urls: turnUrls, username: (process.env.TURN_USERNAME || '').trim(), credential: (process.env.TURN_CREDENTIAL || '').trim() }));
  console.log('TURN: configurado (' + turnUrls.length + ' url).');
} else console.log('TURN: não configurado (opcional — ajuda quando a conexão direta entre as pessoas falha).');
console.log('Build ok. Supabase URL:', url);
