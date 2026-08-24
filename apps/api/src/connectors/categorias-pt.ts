/**
 * Traducao das categorias da Shopee.
 *
 * O datafeed devolve os nomes em ingles ("Home & Living", "Personal Care").
 * A chave e o ID, nunca o nome: o mesmo rotulo aparece embaixo de pais
 * diferentes -- "Tops" existe em Roupas Femininas e em Roupas Masculinas,
 * "Backpacks" em Bolsas Femininas e Masculinas, e "Others" se repete em 20
 * lugares. Traduzir por nome misturaria tudo.
 *
 * Levantado da colheita real do feed (30 raizes, 276 categorias). ID que nao
 * estiver aqui cai no nome em ingles -- e melhor mostrar "Hand Warmers" do que
 * inventar uma traducao errada.
 */
export const CATEGORIAS_PT: Record<number, string> = {
  // ---- Casa e decoracao ----
  100636: 'Casa e decoração',
  100713: 'Móveis',
  100715: 'Ferramentas e reforma',
  100717: 'Utensílios de cozinha',
  100722: 'Festa e decoração',
  100711: 'Decoração',
  100718: 'Louças e mesa posta',
  100716: 'Limpeza da casa',
  100714: 'Jardinagem',
  100721: 'Organizadores',
  100709: 'Banheiro',
  100719: 'Iluminação',
  100710: 'Cama e roupa de cama',
  100708: 'Aromatizadores e velas',
  100723: 'Religião e feng shui',
  100720: 'Segurança residencial',
  100724: 'Casa · outros',
  100712: 'Bolsas térmicas e de gelo',

  // ---- Autopecas e acessorios veiculares ----
  102187: 'Peças e acessórios automotivos',
  102224: 'Peças para carro',
  102251: 'Peças para moto',
  102249: 'Acessórios internos p/ carro',
  102243: 'Acessórios externos p/ carro',
  102264: 'Pneus e rodas',
  102260: 'Acessórios para moto',
  102272: 'Cuidados com o veículo',
  102265: 'Ferramentas automotivas',
  102188: 'Pesados e náutica',
  102271: 'Segurança veicular',
  102601: 'Automotivo · outros',

  // ---- Beleza ----
  100630: 'Beleza',
  100659: 'Cabelo',
  100664: 'Skincare',
  100663: 'Ferramentas de beleza',
  100662: 'Maquiagem',
  102002: 'Banho e corpo',
  100658: 'Mãos, pés e unhas',
  100661: 'Perfumaria',
  100660: 'Cuidados masculinos',
  100665: 'Kits de beleza',
  100666: 'Beleza · outros',

  // ---- Roupas femininas ----
  100017: 'Roupas femininas',
  100099: 'Blusas e tops',
  100104: 'Vestidos',
  100111: 'Lingerie e roupa íntima',
  100110: 'Conjuntos',
  100100: 'Calças e leggings',
  100101: 'Shorts',
  100112: 'Pijamas',
  100118: 'Meias e meia-calça',
  100106: 'Macacões e jardineiras',
  100102: 'Saias',
  100107: 'Jaquetas e casacos',
  100117: 'Tecidos',
  100103: 'Jeans',
  100109: 'Moletons',
  100113: 'Moda gestante',
  100114: 'Trajes típicos',
  100105: 'Vestidos de noiva',
  100115: 'Fantasias',
  100108: 'Suéteres e cardigãs',
  100116: 'Roupas femininas · outros',

  // ---- Esporte e ar livre ----
  100637: 'Esporte e ar livre',
  100725: 'Equipamentos esportivos',
  100727: 'Roupas esportivas',
  100726: 'Calçados esportivos',
  100728: 'Acessórios esportivos',
  100729: 'Esporte · outros',

  // ---- Mae e bebe ----
  100632: 'Mãe e bebê',
  100684: 'Brinquedos',
  100678: 'Banho e cuidados do bebê',
  100679: 'Quarto do bebê',
  100675: 'Alimentação do bebê',
  100683: 'Fraldas e higiene',
  100674: 'Passeio e transporte',
  100682: 'Saúde do bebê',
  100680: 'Segurança do bebê',
  100676: 'Acessórios para gestante',
  100681: 'Fórmulas e papinhas',
  100686: 'Mãe e bebê · outros',
  100677: 'Saúde da gestante',

  // ---- Papelaria ----
  100638: 'Papelaria',
  100734: 'Cadernos e papéis',
  100730: 'Presentes e embalagens',
  100732: 'Material escolar e escritório',
  100733: 'Material de arte',
  100731: 'Escrita e correção',
  100736: 'Papelaria · outros',
  100735: 'Cartas e envelopes',

  // ---- Acessorios de moda ----
  100009: 'Acessórios de moda',
  100034: 'Acessórios diversos',
  100029: 'Colares',
  100025: 'Acessórios de cabelo',
  100022: 'Brincos',
  100030: 'Óculos',
  100026: 'Pulseiras e braceletes',
  100021: 'Anéis',
  100028: 'Bonés e chapéus',
  100035: 'Kits de acessórios',
  100032: 'Cintos',
  100036: 'Acessórios · outros',
  100033: 'Gravatas',
  100023: 'Lenços e echarpes',
  100024: 'Luvas',
  100027: 'Tornozeleiras',

  // ---- Moda infantil ----
  100633: 'Moda infantil',
  100691: 'Roupas de menina',
  100690: 'Roupas de menino',
  100687: 'Roupas de bebê',
  100689: 'Acessórios infantis',
  100693: 'Sapatos de menina',
  100692: 'Sapatos de menino',
  100688: 'Luvinhas e sapatinhos',

  // ---- Eletrodomesticos ----
  100010: 'Eletrodomésticos',
  100041: 'Eletroportáteis de cozinha',
  100039: 'Linha branca',
  100042: 'Material elétrico',
  100038: 'Pequenos eletrodomésticos',
  100040: 'TVs e acessórios',
  100045: 'Controles remotos',
  100037: 'Projetores',
  100043: 'Pilhas e baterias',
  100046: 'Eletrodomésticos · outros',

  // ---- Celulares ----
  100013: 'Celulares e acessórios',
  100075: 'Acessórios para celular',
  100073: 'Celulares',
  100077: 'Celulares · outros',
  100074: 'Vestíveis e smartwatches',
  100072: 'Tablets',

  // ---- Saude ----
  100001: 'Saúde',
  100002: 'Suplementos',
  100019: 'Cuidados pessoais',
  100018: 'Produtos médicos',
  100020: 'Bem-estar sexual',
  100008: 'Saúde · outros',

  // ---- Alimentos e bebidas ----
  100629: 'Alimentos e bebidas',
  100646: 'Snacks',
  100651: 'Bebidas',
  100648: 'Temperos e ingredientes',
  100655: 'Bebidas alcoólicas',
  100650: 'Cereais e matinais',
  100652: 'Laticínios e ovos',
  100649: 'Confeitaria',
  100647: 'Mercearia',
  100653: 'Frescos e congelados',
  100654: 'Padaria',
  100657: 'Alimentos · outros',
  100645: 'Pronto para comer',
  100656: 'Cestas e kits',

  // ---- Livros ----
  100643: 'Livros e revistas',
  100777: 'Livros',
  100779: 'Livros · outros',

  // ---- Pet ----
  100631: 'Pet',
  100668: 'Acessórios para pet',
  100667: 'Ração e alimentos',
  100672: 'Saúde animal',
  100669: 'Areia e higiene',
  100670: 'Banho e tosa',
  100671: 'Roupas para pet',
  100673: 'Pet · outros',

  // ---- Hobbies ----
  100639: 'Hobbies e coleções',
  100737: 'Colecionáveis',
  100739: 'Brinquedos e jogos',
  100741: 'Instrumentos musicais',
  100738: 'Souvenirs',
  100740: 'CD, DVD e Blu-ray',
  100744: 'Artesanato e costura',
  100742: 'Discos de vinil',
  100745: 'Hobbies · outros',
  100743: 'Álbuns de fotos',

  // ---- Roupas masculinas ----
  100011: 'Roupas masculinas',
  100054: 'Camisetas e camisas',
  100055: 'Roupa íntima masculina',
  100062: 'Meias masculinas',
  100053: 'Bermudas e shorts',
  100048: 'Moletons masculinos',
  100052: 'Calças masculinas',
  100050: 'Jaquetas e coletes',
  100057: 'Conjuntos masculinos',
  100047: 'Jeans masculino',
  100049: 'Suéteres masculinos',
  100058: 'Trajes típicos masculinos',
  100060: 'Uniformes',
  100051: 'Ternos',
  100056: 'Pijamas masculinos',
  100059: 'Fantasias masculinas',
  100061: 'Roupas masculinas · outros',

  // ---- Sapatos femininos ----
  100532: 'Calçados femininos',
  100561: 'Rasteiras e chinelos',
  100559: 'Saltos',
  100557: 'Tênis femininos',
  100556: 'Botas femininas',
  100558: 'Sapatilhas',
  100560: 'Anabelas',
  100562: 'Cuidados com calçados',
  100563: 'Calçados femininos · outros',

  // ---- Informatica ----
  100644: 'Informática',
  101934: 'Componentes de PC e notebook',
  101932: 'Computadores de mesa',
  101940: 'Periféricos e acessórios',
  101941: 'Teclados e mouses',
  101939: 'Impressoras e scanners',
  101935: 'Armazenamento',
  101936: 'Redes',
  101933: 'Monitores',
  101943: 'Informática · outros',
  101942: 'Notebooks',
  101938: 'Equipamentos de escritório',

  // ---- Audio ----
  100535: 'Áudio',
  100578: 'Fones de ouvido',
  100582: 'Caixas de som',
  100583: 'Cabos e adaptadores de áudio',
  100580: 'Microfones',
  100584: 'Áudio · outros',
  100581: 'Amplificadores e mesas',
  100579: 'Media players',

  // ---- Sapatos masculinos ----
  100012: 'Calçados masculinos',
  100068: 'Sandálias e chinelos',
  100064: 'Tênis masculinos',
  100063: 'Botas masculinas',
  100069: 'Cuidados com calçados masculinos',
  100067: 'Sapatos sociais',
  100066: 'Mocassins',
  100065: 'Mules masculinos',

  // ---- Relogios ----
  100534: 'Relógios',
  100574: 'Relógios masculinos',
  100573: 'Relógios femininos',
  100576: 'Acessórios de relógio',
  100577: 'Relógios · outros',

  // ---- Bolsas femininas ----
  100016: 'Bolsas femininas',
  100095: 'Bolsas transversais',
  100089: 'Mochilas femininas',
  100097: 'Acessórios para bolsa',
  100094: 'Bolsas de mão',
  100096: 'Carteiras femininas',
  100093: 'Bolsas sacola',
  100090: 'Bolsas para notebook',
  100091: 'Clutches',
  100092: 'Pochetes femininas',

  // ---- Viagem ----
  100015: 'Viagem e bagagem',
  100087: 'Acessórios de viagem',
  100085: 'Malas',
  100086: 'Bolsas de viagem',

  // ---- Games ----
  100634: 'Games e consoles',
  100696: 'Acessórios de console',
  100697: 'Jogos',
  100698: 'Games · outros',
  100695: 'Consoles',

  // ---- Cameras ----
  100635: 'Câmeras e drones',
  100703: 'Acessórios de câmera',
  100700: 'Câmeras de segurança',
  100699: 'Câmeras',
  100702: 'Acessórios de lente',
  100705: 'Drones',
  100706: 'Acessórios de drone',
  100704: 'Limpeza de câmera',
  100707: 'Câmeras · outros',

  // ---- Bolsas masculinas ----
  100533: 'Bolsas masculinas',
  100564: 'Mochilas masculinas',
  100570: 'Bolsas transversais masculinas',
  100571: 'Carteiras masculinas',
  100565: 'Pastas para notebook',
  100569: 'Pochetes masculinas',
  100566: 'Sacolas masculinas',
  100568: 'Necessaires masculinas',

  // ---- Automoveis ----
  100640: 'Automóveis',
  100747: 'Acessórios internos',
  100749: 'Peças automotivas',
  100748: 'Acessórios externos',
  100753: 'Chaveiros e capas de chave',
  100750: 'Ferramentas automotivas',

  // ---- Motos ----
  100641: 'Motos',
  100757: 'Peças de moto',
  100758: 'Capacetes e acessórios',

  // ---- Servicos ----
  100642: 'Ingressos, vouchers e serviços',
  100764: 'Serviços',
};

/** Nome de exibicao: PT quando existe, senao o nome original do feed. */
export function nomeBr(externalId: number, nomeEn: string): string {
  return CATEGORIAS_PT[externalId] ?? nomeEn;
}
