#!/usr/bin/env node
/* Gera o card "Seu mês no Manganana" em SVG → PNG (teste local) */
const sharp = require('sharp');
const fs = require('fs');

// dados de exemplo (mesma simulação do teste anterior)
const data = {
  month: 'julho de 2026',
  chapters: 46,
  mangas: 4,
  days: 16,
  top: [
    { title: 'JoJo Part 7 - Steel Ball Run', chapters: 18 },
    { title: 'Chainsaw Man', chapters: 14 },
    { title: 'Na Honjaman Level-Up', chapters: 9 },
    { title: 'One Piece', chapters: 5 },
  ],
};

const W = 1080, H = 1350;
const NAVY = '#0b1120', NAVY2 = '#111a30', GOLD = '#ffd60a', TEXT = '#e8edf7', MUTED = '#8a94ad';
const BAR = '#ffd60a', BAR2 = '#ff8c00';

const maxCh = Math.max(...data.top.map(t => t.chapters), 1);
const barH = 64, barGap = 26;
const chartTop = 640;
const barStartX = 430;

// barras
let bars = '';
data.top.forEach((t, i) => {
  const w = Math.max(60, (t.chapters / maxCh) * 560);
  const y = chartTop + i * (barH + barGap);
  bars += `
    <text x="30" y="${y + 40}" font-family="Segoe UI, sans-serif" font-size="30" font-weight="bold" fill="${TEXT}">${i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : '•'} ${escapeXml(t.title)}</text>
    <rect x="${barStartX}" y="${y}" width="${w}" height="${barH}" rx="12" fill="${i === 0 ? BAR : '#f0a500'}" opacity="0.92"/>
    <text x="${barStartX + w + 20}" y="${y + 45}" font-family="Segoe UI, sans-serif" font-size="32" font-weight="bold" fill="${GOLD}">${t.chapters}</text>
  `;
});

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${NAVY}"/>
      <stop offset="100%" stop-color="#0a1226"/>
    </linearGradient>
    <linearGradient id="goldline" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${GOLD}"/>
      <stop offset="100%" stop-color="#ff8c00"/>
    </linearGradient>
  </defs>

  <!-- fundo -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <!-- brilho sutil -->
  <circle cx="900" cy="150" r="380" fill="#ffd60a" opacity="0.05"/>
  <circle cx="150" cy="1150" r="320" fill="#ff8c00" opacity="0.05"/>

  <!-- header -->
  <text x="540" y="150" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="52" font-weight="800" fill="${TEXT}">📊 SEU MÊS NO</text>
  <text x="540" y="225" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="64" font-weight="900" fill="${GOLD}">MANGANANA</text>
  <rect x="340" y="265" width="400" height="6" rx="3" fill="url(#goldline)"/>
  <text x="540" y="320" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="32" fill="${MUTED}">${data.month}</text>

  <!-- stats -->
  <g>
    <rect x="60" y="380" width="300" height="180" rx="20" fill="${NAVY2}" stroke="#1e2a4a" stroke-width="2"/>
    <text x="210" y="450" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="64" font-weight="900" fill="${GOLD}">${data.chapters}</text>
    <text x="210" y="500" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="26" fill="${MUTED}">capítulos lidos</text>

    <rect x="390" y="380" width="300" height="180" rx="20" fill="${NAVY2}" stroke="#1e2a4a" stroke-width="2"/>
    <text x="540" y="450" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="64" font-weight="900" fill="${GOLD}">${data.mangas}</text>
    <text x="540" y="500" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="26" fill="${MUTED}">mangás diferentes</text>

    <rect x="720" y="380" width="300" height="180" rx="20" fill="${NAVY2}" stroke="#1e2a4a" stroke-width="2"/>
    <text x="870" y="450" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="64" font-weight="900" fill="${GOLD}">${data.days}</text>
    <text x="870" y="500" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="26" fill="${MUTED}">dias ativos</text>
  </g>

  <!-- título do gráfico -->
  <text x="30" y="600" font-family="Segoe UI, sans-serif" font-size="34" font-weight="800" fill="${TEXT}">MAIS LIDOS</text>
  <rect x="30" y="618" width="70" height="5" rx="2.5" fill="${GOLD}"/>

  <!-- barras -->
  ${bars}

  <!-- rodapé -->
  <rect x="0" y="${H - 110}" width="${W}" height="110" fill="${NAVY2}"/>
  <text x="540" y="${H - 55}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700" fill="${TEXT}">📖 manganana.vercel.app</text>
  <text x="540" y="${H - 20}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="20" fill="${MUTED}">Histórias que viram mundos</text>
</svg>`;

fs.writeFileSync('/tmp/monthly_card.svg', svg);

(async () => {
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  fs.writeFileSync('/tmp/monthly_card.png', png);
  console.log('card gerado:', png.length, 'bytes');
})();
