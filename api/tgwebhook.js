// ===== Webhook do bot do Telegram (responde /start com o ID do usuário) =====
// O Vercel chama esta função quando alguém manda mensagem pro bot.
// POST /api/tgwebhook  (registrado via setWebhook na API do Telegram)

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

module.exports = async function handler(req, res) {
  if (!TG_TOKEN) {
    return res.status(200).json({ ok: false, error: 'bot não configurado' });
  }
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body || {};
  const msg = body.message || body.edited_message || {};
  const chat = msg.chat || {};
  const text = (msg.text || '').trim();

  // responde só comandos
  if (!text.startsWith('/')) return res.status(200).json({ ok: true });

  const chatId = chat.id;
  let reply = '';

  if (text.startsWith('/start')) {
    reply =
      '👋 Olá! Sou o assistente de notificações do <b>Manganana</b> 📖\n\n' +
      'Seu ID do Telegram é:\n\n' +
      `<code>${chatId}</code>\n\n` +
      '1️⃣ Copie esse número\n' +
      '2️⃣ Cole no Manganana (Perfil → Notificações de capítulo)\n' +
      '3️⃣ Pronto! 🔔 Você vai receber aviso quando sair capítulo novo dos mangás da sua lista.';
  } else if (text.startsWith('/id')) {
    reply = `Seu ID: <code>${chatId}</code>`;
  } else {
    reply = 'Use /start para ver seu ID.';
  }

  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: reply,
        parse_mode: 'HTML',
      }),
    });
  } catch (e) {
    console.error('tg webhook reply err:', e.message);
  }

  return res.status(200).json({ ok: true });
};
