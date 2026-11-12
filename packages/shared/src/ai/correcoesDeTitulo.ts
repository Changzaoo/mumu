/**
 * CORREÇÕES CONFERIDAS À MÃO — o que regra nenhuma resolve.
 *
 * `lerTituloDoAcervo` separa título de artista quando o próprio texto dá a
 * pista (aspas, "ft.", "- DJ X", ruído de vídeo). Sobra o que exige saber QUEM
 * canta a música: o canal no lugar do artista ("catman916", "Traduções Anos
 * 80", "GTA VI"), o marcador "Desconhecido", os campos trocados sem pista
 * nenhuma ("HQ" / "Jimi Hendrix, Little wing").
 *
 * Esta tabela é o acervo de 12/11/2026 lido faixa por faixa. Só entrou música
 * reconhecida com certeza; o que era dúvida ficou como estava. A chave é o
 * título GRAVADO (comparado sem caixa, acento nem enfeite de fonte), e a
 * guarda, quando existe, é um pedaço do artista gravado — título genérico como
 * "HQ" ou "Stay" não pode casar com a faixa errada.
 *
 * Passa na frente do leitor: o que está aqui vale mais do que a regra.
 */
export interface CorrecaoDeTitulo {
  title: string;
  artists: string[];
}

/** [título gravado, guarda no artista gravado ('' = sem guarda), título certo, artistas] */
type Linha = readonly [string, string, string, string];

const LINHAS: readonly Linha[] = [
  // ── Campos trocados ou canal no lugar do artista ──────────────────────────
  [
    'Nino Abravanel - Ryan SP, Nego Trufa, Jvila, Meno K, Lele JP (Glenner e Daltin no Beat)',
    'bandoleira',
    'Bandoleira',
    'Nino Abravanel; MC Ryan SP; Nego Trufa; MC Jvila; MC Meno K; MC Lele JP; DJ Glenner; Daltin Beat',
  ],
  ['Living On A Prayer [QHD ]', '', "Livin' on a Prayer", 'Bon Jovi'],
  ['Saturday Night Fever (1977) 4K Movie Clip', 'stayin', "Stayin' Alive", 'Bee Gees'],
  [
    'Saturday Night Fever (Bee Gees, You Should be Dancing) John Travolta HD 1080 with Lyrics',
    '',
    'You Should Be Dancing',
    'Bee Gees',
  ],
  ['A-ha - The Weight of the Wind (Tradução/Legendado)', '', 'The Weight of the Wind', 'a-ha'],
  ['Christopher Cross - Sailing (Tradução/Legendado)', '', 'Sailing', 'Christopher Cross'],
  ['Chilliwack "Fly At Night" Hockey Night In Canada Opening', '', 'Fly at Night', 'Chilliwack'],
  ["ELF - I'm Coming Back For You", 'dio', "I'm Coming Back for You", 'Elf'],
  ['Official Video (HQ)', 'vanessa carlton', 'A Thousand Miles', 'Vanessa Carlton'],
  ['new video', 'joshua radin', "I'd Rather Be with You", 'Joshua Radin'],
  ['Jó - COM LETRA (VideoLETRA® oficial MK Music)', '', 'Jó', 'Midian Lima'],
  ['Salgadinho 2016 Extra Dvd "Minha Verdade"', '', 'Recado à Minha Amada (Lua Vai)', 'Salgadinho'],
  [
    'HD BEST AUDIO QUALITY',
    'ac/dc',
    "It's a Long Way to the Top (If You Wanna Rock 'n' Roll)",
    'AC/DC',
  ],
  [
    "Mc PH, Borges, Wiu (Pedro Lotto, Wey) - ''OCDM''",
    'tenho que me decidir',
    'Tenho Que Me Decidir',
    'MC PH; Borges; Wiu; Pedro Lotto; Wey',
  ],
  [
    'Moraes Moreira "Preta Pretinha" no Acústico MTV em 1995',
    '',
    'Preta Pretinha',
    'Moraes Moreira',
  ],
  [
    'Moraes Moreira "Pombo Correio / Festa do Interior" no Acústico MTV em 1995',
    '',
    'Pombo Correio / Festa do Interior',
    'Moraes Moreira',
  ],
  [
    'O Bagulho e doidão - Kadu - Kyan - GP $ - Hugo CNB ( Áudio oficial )',
    '',
    'O Bagulho É Doidão',
    'MC Kadu; Kyan; MC GP; Hugo CNB; DJ Victor; Caio Passos',
  ],
  [
    'MC Kevin, IG, Rick, Menor da VG, Hariel e Don Juan - Pablo Escobar (GR6 Explode)',
    '',
    'Pablo Escobar',
    'MC Kevin; MC IG; MC Rick; MC Menor da VG; MC Hariel; MC Don Juan',
  ],
  ['Big Bllakk - Muita Luta', 'perfil', 'Muita Luta (Perfil #95)', 'Big Bllakk'],
  ['Guns "N" Roses civil war', '', 'Civil War', "Guns N' Roses"],
  [
    'The Smiths The Boy With The Thorn In His Side HQ',
    '',
    'The Boy with the Thorn in His Side',
    'The Smiths',
  ],
  [
    'Eazy - No Limit REMIX ft. A$AP Rocky, Cardi B, French Montana, Juicy J, Belly',
    '',
    'No Limit (Remix)',
    'G-Eazy; A$AP Rocky; Cardi B; French Montana; Juicy J; Belly',
  ],
  ['Eurythmics "Sex Crime" 1984', '', 'Sexcrime (Nineteen Eighty-Four)', 'Eurythmics'],
  ['"Embraceable You" The Nat King Cole Trio', '', 'Embraceable You', 'Nat King Cole Trio'],
  ['The Beatles "It\'s Only Love" Take 2', '', "It's Only Love (Take 2)", 'The Beatles'],
  [
    "Nik Kershaw I Won't let the Sun Go Down On Me original HQ remastered edit",
    '',
    "I Won't Let the Sun Go Down on Me",
    'Nik Kershaw',
  ],
  [
    "Sylvester Stallone / Over The Top 'Winner Takes It All' Music Video",
    '',
    'Winner Takes It All',
    'Sammy Hagar',
  ],
  [
    'SÁ RODRIX & GUARABYRA POT POURRI DVD BAR & VIOLÃO HD XVID Wide Screen',
    '',
    'Pot-Pourri (Bar & Violão)',
    'Sá, Rodrix & Guarabyra',
  ],
  ['I BEG YOUR PARDON - LEGENDADO (TRADUZIDO)', '', 'I Beg Your Pardon', 'Kon Kan'],
  ['Original Version HQ', 'jennifer paige', 'Crush', 'Jennifer Paige'],
  [
    'GESTÃO INTELIGENTE 💲- MC Cebezinho Ft MC Lele JP (Oldilla e DJ GM) Vídeo Clipe Oficial',
    '',
    'Gestão Inteligente',
    'MC Cebezinho; MC Lele JP; Oldilla; DJ GM',
  ],
  ['Trio -- Da Da Da ]', '', 'Da Da Da', 'Trio'],
  [
    'JOE JACKSON Is She Really Going Out with Him 【HD】',
    '',
    'Is She Really Going Out with Him?',
    'Joe Jackson',
  ],
  ['Eternal', 'bebe winans', 'I Wanna Be the Only One', 'Eternal; BeBe Winans'],
  [
    'Pior Versão - MC Ryan SP, Joãozinho VT, Oruam e MC Kako',
    '',
    'Pior Versão',
    'MC Ryan SP; MC Joãozinho VT; Oruam; MC Kako; DJ Boy',
  ],
  ['Lynyrd Skynyrd HQ', 'simple man', 'Simple Man', 'Lynyrd Skynyrd'],
  ['Streets of Fire - I Can Dream About You', '', 'I Can Dream About You', 'Dan Hartman'],
  ['SoundTrack - KARATE KID II ) HD', 'glory of love', 'Glory of Love', 'Peter Cetera'],
  ['Makaveli - Blasphemy', '2pac', 'Blasphemy', '2Pac'],
  ["Stray Kids 'I LIKE IT' Video", '', 'I Like It', 'Stray Kids'],
  ['MC LIPI', 'set dj gm', 'Set DJ GM 7.0', 'MC Lipi; DJ GM'],
  ['1987")', 'ritchie valens', 'La Bamba', 'Ritchie Valens'],
  [
    'Tell me, Tell me (Into The House Mix) OFFICIAL VÍDEO REMIX BY VJ ROBERTO PORTHINARY',
    '',
    'Tell Me, Tell Me (Into the House Mix)',
    'Moskwa TV',
  ],
  ['LALEH "Live Tomorrow" ( , 2006)', '', 'Live Tomorrow', 'Laleh'],
  ['Friends ( HQ)', 'scooter', 'Friends', 'Scooter'],
  ["Exile 'Kiss You All Over' HQ Audio", '', 'Kiss You All Over', 'Exile'],
  ['1956 "Little Richard"', 'long tall sally', 'Long Tall Sally', 'Little Richard'],
  [
    'DJ Boy "Seis Não é Gângster" Mc\'s Vine 7, Don Juan, Ryan SP, Davi, Tuto, Joãozinho VT',
    '',
    'Seis Não É Gângster',
    'DJ Boy; MC Vine 7; MC Don Juan; MC Ryan SP; MC Davi; MC Tuto; MC Joãozinho VT',
  ],
  ['TECHNOTRONIC - Pump Up The Jam', '', 'Pump Up the Jam', 'Technotronic'],
  ['Hear N\' Aid- "Stars', '', 'Stars', "Hear 'n Aid"],
  [
    "TINA TURNER We Don't Need Another Hero (Thunderdome)【music video】",
    '',
    "We Don't Need Another Hero (Thunderdome)",
    'Tina Turner',
  ],
  ['Eric Johnson - Cliffs of Dover - 100%', '', 'Cliffs of Dover', 'Eric Johnson'],
  ['Gilberto Gil - Domingo no Parque', '', 'Domingo no Parque', 'Gilberto Gil'],
  [
    'Prince - The Most Beautiful Girl In The World - with lyrics.flv',
    '',
    'The Most Beautiful Girl in the World',
    'Prince',
  ],
  [
    '“Giro dos Artistas” MC Bruninho da Praia,MC Kevin,MC IG,MC Magal e MC GP DJ Oreia',
    '',
    'Giro dos Artistas',
    'MC Bruninho da Praia; MC Kevin; MC IG; MC Magal; MC GP; DJ Oreia',
  ],
  ['Pandora - Vulgo FK, Menor MC e MC GP', '', 'Pandora', 'Vulgo FK; Menor MC; MC GP; DJ Matt-D'],
  ['Laura Branigan Self control - Legendado', '', 'Self Control', 'Laura Branigan'],
  ['HQ', 'jimi hendrix', 'Little Wing', 'Jimi Hendrix'],
  [
    'Coração Gelado 3 - MCs Joãozinho VT, Ryan SP, Kako, V7, Leozinho ZS, IG e Letto (Explode)',
    '',
    'Coração Gelado 3',
    'MC Joãozinho VT; MC Ryan SP; MC Kako; MC V7; MC Leozinho ZS; MC IG; MC Letto; DJ Boy',
  ],
  [
    'Díario de um Cafajeste "O amor não paga as conta" MC\'s Lele JP, Ryan SP, Meno k,Negão Original, Tuto',
    '',
    'Diário de um Cafajeste (O Amor Não Paga as Conta)',
    'MC Lele JP; MC Ryan SP; MC Meno K; MC Negão Original; MC Tuto',
  ],
  [
    'Poesia Acústica - Cesar Mc, Ryan SP,Lourena, Major RD, Derxan, Wiu, Djonga,Kayblack,Gloria Groove',
    '',
    'Poesia Acústica',
    'Cesar MC; MC Ryan SP; Lourena; Major RD; Derxan; Wiu; Djonga; Kayblack; Gloria Groove',
  ],
  ['Private Idaho - HQ', '', 'Private Idaho', "The B-52's"],
  [
    'The Doobie Brothers Listen to the Music ~With Lyrics~',
    '',
    'Listen to the Music',
    'The Doobie Brothers',
  ],
  [
    'Time of my Life (Final Dance) - High Quality',
    'dirty dancing',
    "(I've Had) The Time of My Life",
    'Bill Medley; Jennifer Warnes',
  ],
  ['rush limelight music video', '', 'Limelight', 'Rush'],
  [
    'NOITE DO PRAZER-CLAUDIO ZOLI & BANDA BRILHO-CLIPE ORIGINAL-ANO 1983 ( HQ )',
    '',
    'Noite do Prazer',
    'Brylho',
  ],
  [
    'Men Without Hats ~ Safety Dance ~ Live 1985 in Montreal ~ DVD Live Hats',
    '',
    'The Safety Dance',
    'Men Without Hats',
  ],
  ["BTS (방탄소년단) 'SWIM' Official Performance Video", '', 'SWIM', 'BTS'],
  [
    'Filhão - Poze do Rodo - Shenlong - Orochi - Chefin - Leviano - Mvk',
    '',
    'Filhão',
    'MC Poze do Rodo; Shenlong; Orochi; Chefin; Leviano; MVK; Bielzin',
  ],
  ['Motivo MC Ted 011 ( Oficial Clipe)', '', 'Motivo', 'MC Ted 011'],
  ['Houses of the Holy by Led Zeppelin in 1080p', '', 'Houses of the Holy', 'Led Zeppelin'],
  [
    'MC MENO K e MC NEGÃO ORIGINAL LANÇAMENTO 2025',
    'comedinha',
    'Comedinha Ficou Bravo',
    'MC Meno K; MC Negão Original; DJ Japa NK',
  ],
  [
    'Mc Kaverinha e Mc Neguin da BRC ( )',
    'guaruja',
    'Vou Descer pra Guarujá',
    'MC Kaverinha; MC Neguin da BRC; DJ David LP',
  ],
  ['É HOJE', 'aquela mina de vermelho', 'Aquela Mina de Vermelho', 'DJ Arana'],
  ['4 AQUELA MINA DE VERMELHO', 'arana', 'Aquela Mina de Vermelho', 'DJ Arana'],
  ['Como Nossos Pais Belchior ao vivo.avi', '', 'Como Nossos Pais', 'Belchior'],
  ['Desireless john.flv', '', 'John', 'Desireless'],
  ['Janis Joplin~ Work Me Lord', '', 'Work Me, Lord', 'Janis Joplin'],
  [
    'Paulinho da Viola em Foi um rio que passou em minha vida.wmv',
    '',
    'Foi um Rio Que Passou em Minha Vida',
    'Paulinho da Viola',
  ],
  ['U2 Street Mission extended version 1978.mp4', '', 'Street Mission', 'U2'],
  ['~THIN LIZZY~ JAILBREAK', '', 'Jailbreak', 'Thin Lizzy'],
  [
    "''LET'S GO 2'' DJ GBR, MC IG, Ryan SP, Hariel, Marks, Don Juan, PH, Kadu e MC Luki",
    '',
    "Let's Go 2",
    'DJ GBR; MC IG; MC Ryan SP; MC Hariel; MC Marks; MC Don Juan; MC PH; MC Kadu; MC Luki',
  ],
  [
    'Set DJ Japa NK 2.0 Ryan SP, Meno K, Luuky, Rodrigo do CN, IG, Jacaré, GH do 7, Lele JP, JVila, Oruam',
    '',
    'Set DJ Japa NK 2.0',
    'DJ Japa NK; MC Ryan SP; MC Meno K; MC Luuky; MC Rodrigo do CN; MC IG; MC Jacaré; MC GH do 7; MC Lele JP; MC Jvila; Oruam',
  ],
  [
    'BG The Prince Of Rap no Faustao (1994) The Colour Of My Dreams & Round And Round',
    '',
    'The Colour of My Dreams / Round and Round',
    'B.G. The Prince of Rap',
  ],
  ['Stay', 'london records', 'Stay', 'Shakespears Sister'],
  ["THE GOONIES 'R' GOOD ENOUGH", 'goonies', "The Goonies 'R' Good Enough", 'Cyndi Lauper'],
  ['A DANADA ME LIGANDO', 'love funk', 'A Danada Me Ligando', 'MC Cebezinho; MC Tuto; MC Kako'],
  ['Saca da Twin', 'chatao', 'Saca da Twin', 'MC Lele JP'],
  ['Saca da Twin 2 "O Poderoso Chatão"', '', 'Saca da Twin 2', 'MC Lele JP'],
  ['Procol Harum', 'whiter shade', 'A Whiter Shade of Pale', 'Procol Harum'],
  [
    '"Flower In A Hurricane" - Justice feat. Tame Impala, SZA, King Gizzard & the Lizard Wizard',
    '',
    'Flower In A Hurricane',
    'Justice; Tame Impala; SZA; King Gizzard & the Lizard Wizard',
  ],
  ['"Se Me Nota (Agarrame)" - Chimbala x Omega', '', 'Se Me Nota (Agárrame)', 'Chimbala; Omega'],
  [
    '"But I Think It\'s A Dream" - Captain & Tennille',
    '',
    "But I Think It's a Dream",
    'Captain & Tennille',
  ],
  [
    'ILUSÃO "CRACOLÂNDIA"',
    'alok',
    'Ilusão (Cracolândia)',
    'Alok; MC Hariel; MC Davi; MC Ryan SP; Salvador da Rima; Djay W',
  ],

  // ── Sem artista ("Desconhecido"): o título dizia quem canta ───────────────
  ['Damian marley-half way tree', '', 'Half Way Tree', 'Damian Marley'],
  ['MARIA BETANIA GRITO DE ALERTA', '', 'Grito de Alerta', 'Maria Bethânia'],
  ['George Baker- Little Green Bag', '', 'Little Green Bag', 'George Baker Selection'],
  ['Amigo É Para Essas Coisas MPB4', '', 'Amigo É pra Essas Coisas', 'MPB4'],
  ['"Mas Que Nada" Sérgio Mendes & Brasil \'66', '', 'Mas Que Nada', "Sérgio Mendes & Brasil '66"],
  ['Senhorita (Zé Geraldo)', '', 'Senhorita', 'Zé Geraldo'],
  ["That's That (AOL Music) by Snoop Dogg", '', "That's That", 'Snoop Dogg'],
  ['Gerry Rafferty Baker Street Long Version', '', 'Baker Street', 'Gerry Rafferty'],
  [
    'MC PH, MC LEOZINHO ZS, MC PIKACHU, MC LELE JP, MC DON JUAN & DJ FELIPE MAIA THE BOX MEDLEY FUNK 5',
    '',
    'The Box Medley Funk 5',
    'MC PH; MC Leozinho ZS; MC Pikachu; MC Lele JP; MC Don Juan; DJ Felipe Maia',
  ],
  [
    'DUDU, BORGES, SALVADOR DA RIMA, MC IGU & ECOLOGYK THE BOX MEDLEY 8',
    '',
    'The Box Medley 8',
    'Dudu; Borges; Salvador da Rima; MC Igu; Ecologyk',
  ],
  [
    'MC Ryan SP, MC MenoK, MC LUUKY, MC GP, Negão Original, Mc Brinquedo, Mc Fejuca-THE BOX MEDLEY FUNK10',
    '',
    'The Box Medley Funk 10',
    'MC Ryan SP; MC Meno K; MC Luuky; MC GP; MC Negão Original; MC Brinquedo; MC Fejuca',
  ],
  ['feel the love(Oomachasaooma) (1983)', '', 'Feel the Love (Oomachasaooma)', '10cc'],
  ['the wall street shuffle (1974)', '', 'The Wall Street Shuffle', '10cc'],
  ['Normaal-Oerend hard', '', 'Oerend Hard', 'Normaal'],
  ['YouTube Anouk Three Days In A Row', '', 'Three Days in a Row', 'Anouk'],
  ['De Dijk Groot Hart', '', 'Groot Hart', 'De Dijk'],
  ['Sunrise Avenue Fairytale Gone Bad Video Clip', '', 'Fairytale Gone Bad', 'Sunrise Avenue'],
  ['Tocando em Frente, por Almir Sater', '', 'Tocando em Frente', 'Almir Sater'],
  [
    'Steppenwolf "It\'s Never Too Late" on The Ed Sullivan Show',
    '',
    "It's Never Too Late",
    'Steppenwolf',
  ],
  ['Steppenwolf Renegade 1970', '', 'Renegade', 'Steppenwolf'],
  ['Time by Pink Floyd (Flash Animation)', '', 'Time', 'Pink Floyd'],
  ['Pat Benatar- Hit Me With Your Best Shot', '', 'Hit Me with Your Best Shot', 'Pat Benatar'],
  [
    'Filipe Ret "VIVENDO AVANÇADO" pt. BK\' e Mc TH (pd. Rick Beatz)',
    '',
    'Vivendo Avançado',
    "Filipe Ret; BK'; MC TH",
  ],
  [
    'A Cara do Crime "NÓS INCOMODA"- MC Poze do Rodo',
    '',
    'A Cara do Crime (Nós Incomoda)',
    'MC Poze do Rodo',
  ],
  ["Let's Stay Together Tina Turner", '', "Let's Stay Together", 'Tina Turner'],
  ['spirit in the sky Norman Greenbaum', '', 'Spirit in the Sky', 'Norman Greenbaum'],
  ['AQUARELA TOQUINHO', '', 'Aquarela', 'Toquinho'],
  [
    'J.Eskine, MC Davi, MC G15, DG e Batidão Stronda',
    'desconhecido',
    'Mãe Solteira',
    'J. Eskine; MC Davi; MC G15; DG e Batidão Stronda',
  ],
  [
    'Emoções VERSÃO SUJA feat. Orochi (Versão emocoes suja feat orochi)',
    '',
    'Emoções (Versão Suja)',
    'Orochi',
  ],
  ['7 Seconds', 'neneh cherry', '7 Seconds', "Youssou N'Dour; Neneh Cherry"],
  ['Big Yellow Taxi', 'vanessa carlton', 'Big Yellow Taxi', 'Counting Crows; Vanessa Carlton'],

  // ── Artista certo, título com sobra que a regra não alcança ───────────────
  [
    'The Pusher, Born to Be Wild (Easy Rider OST) 4K Scan',
    'steppenwolf',
    'The Pusher / Born to Be Wild',
    'Steppenwolf',
  ],
  ['Lonely - Vevo (Ao Vivo)', 'justin bieber', 'Lonely', 'Justin Bieber'],
  [
    '04 - You Are The Biggest Thing Since Powdered Milk',
    'budgie',
    "You're the Biggest Thing Since Powdered Milk",
    'Budgie',
  ],
  [
    'Snoop Dogg "Ridin In My Chevy" & "My Medicine" Official Music Videos, Double Feature',
    '',
    "Ridin' in My Chevy / My Medicine",
    'Snoop Dogg',
  ],
  ['White Room - Lyrics', 'cream', 'White Room', 'Cream'],
  ['Higher - Lyrics', 'erik', 'Higher', 'Erik Grönwall'],
  ['DVD Qual Seu Maior Sonho? - Não Existe Mais Amor', 'marks', 'Não Existe Mais Amor', 'MC Marks'],
  [
    "I Got Dem Ol' Kozmic Blues Again Mama! - 04 - As Good As You've Been To This World",
    'janis joplin',
    "As Good as You've Been to This World",
    'Janis Joplin',
  ],
  [
    'Back in the U.S.S.R. - fan made Music Video - ROCK BAND / MODERN WARFARE',
    'beatles',
    'Back in the U.S.S.R.',
    'The Beatles',
  ],
  ['Step by Step - - Subtitulado Español', 'new kids', 'Step by Step', 'New Kids On the Block'],
  [
    'Vem Cear Comigo - (Maximus Records) #musicagospel2023',
    'gerson',
    'Vem Cear Comigo',
    'Gerson Rufino',
  ],
  [
    'Could You Be Loved - Maquinaria Festival Chile 2011',
    'damian marley',
    'Could You Be Loved',
    'Damian Marley',
  ],
  [
    'Could you be loved - Couleur Cafe 2010.mp4',
    'damian marley',
    'Could You Be Loved',
    'Damian Marley',
  ],
  [
    'Renasci das cinzas - Lyons produções',
    'daniel',
    'Renasci das Cinzas',
    'MC Daniel; MC Paulin da Capital',
  ],
  [
    'Love Is All Around - Four Weddings and a Funeral Soundtrack',
    'wet wet wet',
    'Love Is All Around',
    'Wet Wet Wet',
  ],
  [
    'Woody Boogie - Full Original Short Film Real Video (Remastered By Italoco)',
    'baltimora',
    'Woody Boogie',
    'Baltimora',
  ],
  ['Blue Savannah Legendado em PT- BR', 'erasure', 'Blue Savannah', 'Erasure'],
  [
    "You Ain't Seen Nothing Yet 1974 Video Sound HQ",
    'bachman',
    "You Ain't Seen Nothing Yet",
    'Bachman-Turner Overdrive',
  ],
  [
    'Depeche Mode Enjoy The Silence Official Music Video 16 9 HD',
    'depeche mode',
    'Enjoy the Silence',
    'Depeche Mode',
  ],
  ['Holiday Rap HQ Videoclip!!!', 'miker', 'Holiday Rap', 'MC Miker G.; DJ Sven'],
  ['Sonho Possível Vídeo Clipe', 'mc rah', 'Sonho Possível', 'MC Rah; DJ Tripa'],
  [
    'Fim de Semana Na Quebrada - ( ) #2P',
    'pollo',
    'Fim de Semana na Quebrada',
    'Pollo; MC Pedrinho',
  ],
  [
    'Tough Enough - Heineken Concerts - 1997',
    'johnny clegg',
    'Tough Enough',
    'Johnny Clegg; Savuka',
  ],
  [
    'Hoje o Dia tá Bonito (Plin Plin) - GringoBeats808',
    'marks',
    'Hoje o Dia Tá Bonito (Plin Plin)',
    'MC Marks; GringoBeats808',
  ],
  [
    'Distant Relatives - Africa Must Wake Up (Live - Best Quality)',
    'damian marley',
    'Africa Must Wake Up',
    'Nas; Damian Marley',
  ],
  ['Passa a Visão (DJ Boy) - Faixa 7 - NTDD', 'dj boy', 'Passa a Visão', 'DJ Boy'],
  [
    'Dreamland - One and One - Radio Version',
    'robert miles',
    'One and One (Radio Version)',
    'Robert Miles; Maria Nayler',
  ],
  ['Me & You feat. IRO – from XOXO the Netflix Original Film', 'alok', 'Me & You', 'Alok; IRO'],
  ['Deep Down LIVE Video', 'alok', 'Deep Down', 'Alok; Ella Eyre; Kenny Dope; Never Dull'],
  ['Férias da Metrópole - Murillo e LT e Duani', 'marks', 'Férias da Metrópole', 'MC Marks'],
  [
    'Steppenwolf- "Rock Me" 1969 [Reelin\' In The Years Archives]',
    'steppenwolf',
    'Rock Me',
    'Steppenwolf',
  ],
  ['A Little Respect - BBC Comic Relief March 2017', 'andy bell', 'A Little Respect', 'Andy Bell'],
  [
    'Enemy (From the series "Arcane League of Legends")',
    'imagine dragons',
    'Enemy',
    'Imagine Dragons',
  ],
  ['Filipe Ret "ILUSÃO" ⏳ (pd. Dallass)', 'filipe ret', 'Ilusão', 'Filipe Ret'],
  [
    'Wuthering Heights (Morro dos Ventos Uivantes) - Tradução',
    'kate bush',
    'Wuthering Heights',
    'Kate Bush',
  ],
  ['TT (Prod. Nagalli) - HORA DO RUSH Vol. 2', '', 'TT', 'JÉ'],
  ['ROUND AND ROUND - LEGENDADO (TRADUZIDO)', 'new order', 'Round and Round', 'New Order'],
  ['Toquinho "Aquarela" 1983 HD', 'toquinho', 'Aquarela', 'Toquinho'],
  ['Ordinary Day - 2002-08-24', 'vanessa carlton', 'Ordinary Day', 'Vanessa Carlton'],
  ['Always (Die große Drei-Länder-Show - 2017-10-01)', 'erasure', 'Always', 'Erasure'],
  [
    'Milionários (DVD Haridade) Perera DJ e T Beatz',
    'hariel',
    'Milionários',
    'MC Hariel; Perera DJ; T Beatz',
  ],
  [
    'Fazendo Amor (DVD Haridade) Perera DJ e T Beatz',
    'hariel',
    'Fazendo Amor',
    'MC Hariel; Perera DJ; T Beatz',
  ],
  [
    'Inevitável / Cheiro Bom (DVD Funk on The Beach) T Beatz',
    'kaxeta',
    'Inevitável / Cheiro Bom',
    'MC Neguinho do Kaxeta; T Beatz',
  ],
  [
    'OH Mãe Ce Pensa Que eu Não Vi (DJ Gui DeNovo) Vídeo',
    'cebezinho',
    'Oh Mãe Cê Pensa Que Eu Não Vi',
    'MC Cebezinho; DJ Gui de Novo',
  ],
  ['Moça Bonita -- By Ogro.wmv', 'geraldo azevedo', 'Moça Bonita', 'Geraldo Azevedo'],
  ['Go your own way Live 1979 (360p).avi', 'fleetwood mac', 'Go Your Own Way', 'Fleetwood Mac'],
  [
    "Give a Little Bit with Children's Choir, written and composed by Roger Hodgson",
    'roger hodgson',
    'Give a Little Bit',
    'Roger Hodgson',
  ],
  ['Metallica: Nothing Else Matters', 'metallica', 'Nothing Else Matters', 'Metallica'],
  ['Brolle, Playing with fire', 'brolle', 'Playing with Fire', 'Brolle'],
  ['Lei Anti Oruam (Prod. Maurin, Victor Wao)', 'oruam', 'Lei Anti Oruam', 'Oruam'],
];

/** Sem caixa, sem acento, sem enfeite de fonte ("𝕻𝖗𝖔𝖈𝖔𝖑" → "procol"), sem emoji. */
function chaveDeCorrecao(texto: string): string {
  return (texto ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\u200B|\u200C|\u200D|\u2060|\uFE0F/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const TABELA: ReadonlyMap<string, { guarda: string; title: string; artists: string[] }[]> = (() => {
  const mapa = new Map<string, { guarda: string; title: string; artists: string[] }[]>();
  for (const [gravado, guarda, title, artistas] of LINHAS) {
    const k = chaveDeCorrecao(gravado);
    const lista = mapa.get(k) ?? [];
    lista.push({
      guarda: chaveDeCorrecao(guarda),
      title,
      artists: artistas
        .split(';')
        .map((a) => a.trim())
        .filter(Boolean),
    });
    mapa.set(k, lista);
  }
  return mapa;
})();

/** Quantas correções a tabela tem — para o teste e para o log da curadoria. */
export const TOTAL_DE_CORRECOES_DE_TITULO = LINHAS.length;

/**
 * A correção conferida para esta faixa, ou `null`. Devolve `null` também quando
 * a faixa já está como a tabela manda — quem chama não regrava à toa.
 */
export function corrigirTituloConhecido(
  titulo: string,
  artistas: readonly string[],
): CorrecaoDeTitulo | null {
  const candidatas = TABELA.get(chaveDeCorrecao(titulo));
  if (!candidatas) return null;
  const gravados = chaveDeCorrecao(artistas.join(', '));
  const achada = candidatas.find((c) => !c.guarda || gravados.includes(c.guarda));
  if (!achada) return null;
  const igual =
    achada.title === titulo &&
    achada.artists.length === artistas.length &&
    achada.artists.every((a, i) => a === artistas[i]);
  return igual ? null : { title: achada.title, artists: [...achada.artists] };
}
