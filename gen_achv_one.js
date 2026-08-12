#!/usr/bin/env node
/* Card INDIVIDUAL de conquista — medalha vetorial desenhada (sem emojis, sharp-friendly) */
const sharp = require('sharp');
const fs = require('fs');

// exemplo: conquista individual
const achv = {
  icon: 'BOOK',       // tipo de medalha
  title: 'Leitor dedicado',
  desc: 'Leia 50 capítulos',
  count: '4/15',
  date: '12 de agosto de 2026',
  unlocked: true,
};

const W = 1080, H = 1350;
const NAVY = '#0b1120', NAVY2 = '#111a30', GOLD = '#ffd60a', GOLD2 = '#ff8c00', TEXT = '#e8edf7', MUTED = '#8a94ad';

// medalha: anel dourado + estrela interna + faixa
const medal = `
  <!-- brilho atrás da medalha -->
  <circle cx="540" cy="520" r="240" fill="#ffd60a" opacity="0.12"/>
  <circle cx="540" cy="520" r="190" fill="#ffd60a" opacity="0.08"/>
  <!-- faixas laterais da medalha -->
  <path d="M 430 660 L 380 800 L 430 780 L 470 880 L 510 780 L 560 900 L 610 780 L 650 880 L 690 780 L 740 800 L 690 660 Z" fill="#b8860b"/>
  <!-- anel externo -->
  <circle cx="540" cy="520" r="170" fill="none" stroke="#ffd60a" stroke-width="14"/>
  <circle cx="540" cy="520" r="148" fill="#182238" stroke="#ff8c00" stroke-width="6"/>
  <!-- estrela interna -->
  <polygon points="540,410 570,470 635,470 585,510 600,570 540,535 480,570 495,510 445,470 510,470" fill="#ffd60a"/>
  <circle cx="540" cy="520" r="40" fill="#b8860b"/>
  <text x="540" y="538" text-anchor="middle" font-family="Georgia, serif" font-size="44" font-weight="bold" fill="#0b1120">50</text>
`;

// confete: círculos coloridos espalhados
const confetti = [
  [120, 300, '#ffd60a'], [940, 260, '#ff8c00'], [180, 880, '#37c8e0'], [900, 900, '#ffd60a'],
  [100, 580, '#ff8c00'], [980, 550, '#37c8e0'], [240, 150, '#37c8e0'], [860, 140, '#ffd60a'],
  [150, 1050, '#ffd60a'], [930, 1050, '#ff8c00'],
].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="8" fill="${c}" opacity="0.5"/>`).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${NAVY}"/><stop offset="100%" stop-color="#0a1226"/>
    </linearGradient>
    <linearGradient id="goldline" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${GOLD}"/><stop offset="100%" stop-color="${GOLD2}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${confetti}

  <!-- topo -->
  <text x="540" y="130" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="34" font-weight="800" letter-spacing="4" fill="${MUTED}">CONQUISTA DESBLOQUEADA</text>
  <rect x="370" y="160" width="340" height="5" rx="2.5" fill="url(#goldline)"/>

  <!-- medalha -->
  ${medal}

  <!-- nome da conquista -->
  <text x="540" y="1020" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="66" font-weight="900" fill="${GOLD}">${achv.title}</text>

  <!-- descrição -->
  <text x="540" y="1090" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="30" fill="${TEXT}">${achv.desc}</text>

  <!-- data + progresso -->
  <text x="540" y="1160" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="24" fill="${MUTED}">${achv.date}</text>

  <!-- rodapé -->
  <rect x="0" y="${H - 105}" width="${W}" height="105" fill="${NAVY2}"/>
  <text x="540" y="${H - 55}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700" fill="${TEXT}">📖 manganana.vercel.app</text>
  <text x="540" y="${H - 22}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="20" fill="${MUTED}">Histórias que viram mundos</text>
</svg>`;

fs.writeFileSync('/tmp/achv_one.svg', svg);
(async () => {
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  fs.writeFileSync('/tmp/achv_one.png', png);
  console.log('card individual gerado:', png.length, 'bytes');
})();
