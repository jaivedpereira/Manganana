# 🍌 Manganana

> *Histórias que viram mundos.*

Aplicativo web de leitura de mangá em **português** — catálogo real com a **API do MangaDex**, capas oficiais, informações completas, leitor de capítulos com rolagem vertical, favoritos e histórico.

## ✨ Funcionalidades

- 🏠 **Início** — hero com destaque, mangás em alta, lançamentos recentes e "continue lendo"
- 🔍 **Explorar** — busca em tempo real + filtros por gênero (tags do MangaDex)
- 📚 **Biblioteca** — favoritos e histórico de leitura (salvos no navegador)
- 📖 **Leitor completo** — capítulos em PT-BR com:
  - Rolagem vertical ou modo página
  - Qualidade original ou economia de dados
  - Leitura RTL (direita → esquerda)
  - Navegação entre capítulos (anterior/próximo + lista)
  - Progresso salvo automaticamente
- 🌗 Tema escuro (padrão) e claro
- 📱 Layout mobile-first (estilo app com bottom nav)
- 📲 **PWA instalável** — instala no celular como app nativo (ícone, tela cheia)
- ⬇️ **Downloads offline** — baixe capítulos e leia sem internet
- ⚡ Carregamento instantâneo via service worker

## 🚀 Como rodar

```bash
cd manganana
python -m http.server 4173
```

Abra `http://localhost:4173`

## 📡 API utilizada

- **MangaDex API v5** — https://api.mangadex.org (provedor principal)
  - Busca de mangás com tradução em pt-br (`availableTranslatedLanguage[]=pt-br`)
  - Capas: `uploads.mangadex.org/covers/{mangaId}/{fileName}`
  - Capítulos: feed do mangá (`/manga/{id}/feed`)
  - Páginas: servidor at-home (`/at-home/server/{chapterId}`)
- **AniList GraphQL** — https://graphql.anilist.co (dados premium: nota, popularidade, personagens)
- **MangaPill** — https://mangapill.com (provedor secundário de capítulos via scraping serverless)

## 🌐 Multi-provedor e idiomas

- **Seletor de idioma**: cada mangá mostra os idiomas disponíveis (pt-br, en, es-la, fr, ja...) com contagem de capítulos — toque para trocar
- **MangaPill**: quando o MangaDex não tem o capítulo, o app oferece o MangaPill (capítulos em inglês) como alternativa
- Proxies serverless no Vercel resolvem CORS e bloqueios de User-Agent:
  - `/api/proxy` — dados MangaDex
  - `/api/img` — imagens (MangaDex, AniList, MangaPill com Referer correto)
  - `/api/anilist` — dados premium
  - `/api/pill` — scraping MangaPill (busca, capítulos, páginas)

> Obs: mangás licenciados (sem tradução pt-br no MangaDex) aparecem sem capítulos pt-br — troque o idioma ou use o MangaPill.

## 📁 Estrutura

```
manganana/
├── index.html   # Estrutura do app (SPA mobile-first)
├── styles.css   # Tema dark/amarelo, bottom nav, leitor
├── app.js       # API MangaDex, render, leitor, favoritos
└── vercel.json  # Deploy estático no Vercel
```

## 🛠️ Próximos passos

- [ ] Login e sincronização de favoritos na nuvem
- [ ] Leitura offline (PWA)
- [ ] Social: seguir amigos e ver o que estão lendo
- [ ] Chat entre leitores
- [ ] Notificações de novos capítulos

---

Feito para quem vive mil histórias. ✦
