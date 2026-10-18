/* ============================================================
   LIVES DE MÚSICA (rádios ao vivo do YouTube)
   Antes isso era o card "RIMK FM" das telas de login/criar sala.
   Agora o card não existe mais: esta lista é usada para, quando alguém
   cria uma sala de MÚSICA, já começar tocando uma live sorteada.

   COMO EDITAR AS LISTAS (GENRES, logo abaixo)
   - Cada item é { id, title }.
     id    = ID do vídeo/live do YouTube: em youtube.com/watch?v=ABCDEFGHIJK
             o ID é ABCDEFGHIJK (11 caracteres).
     title = nome que aparece na playlist da sala.
   - Lives caem de vez em quando (direitos autorais, canal reinicia a
     transmissão). Se uma não abrir, a sala pula sozinha para outra da
     lista. Quanto mais itens por gênero, mais difícil ficar sem som.
   - Para criar um gênero novo, é só acrescentar um bloco aqui.
   ============================================================ */
(function () {
    'use strict';

    const GENRES = {
        lofi: {
            label: 'Lofi',
            items: [
                { id: 'jfKfPfyJRdk', title: 'Lofi Girl: beats to relax/study to' },
                { id: 'rUxyKA_-grg', title: 'Lofi Girl: beats to sleep/chill to' },
                { id: '5yx6BWlEVcY', title: 'Chillhop Radio' },
                { id: 'F45VjqUG50g', title: 'Coffee Shop Radio: lofi e jazzhop' }
            ]
        },
        synthwave: {
            label: 'Synthwave',
            items: [
                { id: '4xDzrJKXOOY', title: 'Lofi Girl: synthwave radio' },
                { id: 'FQBBDo9HuJw', title: 'New Retro FM' },
                { id: 'qWmQB6ZI6Z4', title: 'Night Drive Radio' },
                { id: 'ylW6bU_COFI', title: 'Retro Future TV' },
                { id: 'edEtJ7pt0Gc', title: '1985 Synthwave Rider FM' }
            ]
        },
        jazz: {
            label: 'Jazz',
            items: [
                { id: 'E2vONfzoyRI', title: 'Lofi Girl: jazz lofi radio' },
                { id: 'HuFYqnbVbzY', title: 'Lofi Girl: jazz lofi radio (live anterior)' },
                { id: 'fu0CVjECxaI', title: 'Smooth Jazz & Relaxing R&B Radio' },
                { id: 'psEr3_r9Yqw', title: 'Smooth Jazz Radio: cafe jazz' },
                { id: 'a0VEGKAVXzg', title: 'Relaxing Acoustic Jazz Radio' },
                { id: 'XOdkLeg30Dw', title: 'Morning Smooth Jazz Radio' },
                { id: 'cEyzOqjkY1M', title: 'Smooth jazz guitar: city night' }
            ]
        },
        rock: {
            label: 'Rock',
            items: [
                { id: 'azMujFR8pOM', title: '24/7 Classic Rock Radio' },
                { id: 'iemujlJ3q_c', title: 'Classic Rock Radio (Classic Rock Revival)' },
                { id: 'CuroyKtk-fY', title: 'RGN Rock/Metal Radio' },
                { id: 'VjJBTWuhQik', title: 'Classic Rock Radio' },
                { id: 'KrExkKoN9y4', title: 'Burning Station: rock & metal' }
            ]
        }
    };

    const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;

    // só entra o que estiver escrito certo (item inválido é ignorado)
    const pool = [];
    Object.keys(GENRES).forEach((g) => {
        GENRES[g].items.forEach((it) => {
            if (it && VIDEO_RE.test(it.id)) pool.push({ videoId: it.id, title: it.title || 'Rádio ao vivo', genre: g, genreLabel: GENRES[g].label });
            else console.warn('[lives] item inválido ignorado:', it);
        });
    });

    // Sorteia uma live. Primeiro sorteia o gênero e depois a live dentro dele,
    // para um gênero com muitas lives não dominar. `skip` = IDs que já falharam/tocaram.
    function random(skip) {
        const out = new Set(skip || []);
        const left = pool.filter((p) => !out.has(p.videoId));
        if (!left.length) return null;
        const genres = [...new Set(left.map((p) => p.genre))];
        const g = genres[Math.floor(Math.random() * genres.length)];
        const inGenre = left.filter((p) => p.genre === g);
        return inGenre[Math.floor(Math.random() * inGenre.length)];
    }

    window.RimkLives = { random, count: () => pool.length };
})();
