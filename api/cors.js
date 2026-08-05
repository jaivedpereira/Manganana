// ===== CORS seguro para o Manganana =====
// Em vez de '*' (qualquer site pode chamar a API com o token do usuário),
// restringe para as origens do próprio app. Em produção local (localhost)
// também permite o dev.

const ALLOWED_ORIGINS = new Set([
  'https://manganana.vercel.app',
  'http://localhost:4173',
  'http://localhost:3000',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:3000',
  // previews do Vercel (padrão *.vercel.app do projeto)
]);

// aplica os headers de CORS em um res; retorna true se a origem é permitida
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed =
    !origin || // sem Origin (curl, apps nativos) — não é browser, ok
    ALLOWED_ORIGINS.has(origin) ||
    /^https:\/\/manganana-[a-z0-9-]+-jaiveds-projects\.vercel\.app$/.test(origin) ||
    /^https:\/\/[a-z0-9-]+-jaiveds-projects\.vercel\.app$/.test(origin);

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  return allowed;
}

module.exports = { applyCors, ALLOWED_ORIGINS };
