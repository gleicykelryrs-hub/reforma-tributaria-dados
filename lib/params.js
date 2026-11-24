/* Parâmetros versionados do motor. Nenhuma alíquota fica fixa no código do motor.
   status: 'definitivo' (norma publicada) | 'estimado' (cálculo oficial ainda não fixado) | 'cenario' (premissa de simulação) */
(function (root) {
  const P = {
    verificadoEm: '2026-11-23',
    anos: [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033],

    // Alíquota de referência da CBS (% ao ano). 2027: cálculo do TCU, Senado ainda não fixou.
    cbsRef: {
      valor: 11.3, status: 'estimado',
      fonte: 'TCU, Acórdão 2933/2026-Plenário (28/10/2026). Senado fixa por resolução até 15/12/2026 (LC 214/2025, art. 349).'
    },
    // Redução de 0,1 p.p. na CBS em 2027 e 2028; IBS de 0,1% no mesmo período.
    cbsReducaoTeste: { valor: 0.1, status: 'definitivo', fonte: 'LC 214/2025, art. 347' },
    ibsTeste: { valor: 0.1, status: 'definitivo', fonte: 'LC 214/2025, disposições transitórias (arts. 343 a 349)' },
    // Ano-teste 2026: destaque de CBS 0,9% e IBS 0,1%, sem aumento de carga.
    teste2026: { cbs: 0.9, ibs: 0.1, status: 'definitivo', fonte: 'EC 132/2023 (ADCT, art. 125) e tabela ALIQUOTA_REFERENCIA do código oficial da Receita Federal' },

    // Soma CBS + IBS em 2033 (cenários). Não há alíquota de IBS fixada.
    cenarios: {
      otimista: { nome: 'Otimista', total: 25.0 },
      base: { nome: 'Base', total: 26.5 },
      pessimista: { nome: 'Pessimista', total: 28.0 }
    },
    cenarioFonte: 'Cenário de simulação. A referência de 26,5% é a trava do art. 475 da LC 214/2025; as alíquotas de referência do IBS ainda não foram fixadas.',

    // Transição ICMS/ISS x IBS (fração da alíquota cheia em cada ano)
    transicao: {
      2026: { legado: 1.0, ibs: 0, pisCofins: true },
      2027: { legado: 1.0, ibs: 0, pisCofins: false },
      2028: { legado: 1.0, ibs: 0, pisCofins: false },
      2029: { legado: 0.9, ibs: 0.1, pisCofins: false },
      2030: { legado: 0.8, ibs: 0.2, pisCofins: false },
      2031: { legado: 0.7, ibs: 0.3, pisCofins: false },
      2032: { legado: 0.6, ibs: 0.4, pisCofins: false },
      2033: { legado: 0.0, ibs: 1.0, pisCofins: false }
    },
    transicaoFonte: 'EC 132/2023 (ADCT, arts. 125 a 129) e LC 214/2025, Livro III (transição)',

    // Tributos atuais
    pisCofinsCumulativo: { valor: 3.65, status: 'definitivo', fonte: 'Leis 9.718/1998 (PIS 0,65% + Cofins 3%)' },
    pisCofinsNaoCumulativo: { valor: 9.25, status: 'definitivo', fonte: 'Leis 10.637/2002 e 10.833/2003 (PIS 1,65% + Cofins 7,6%)' },
    irpj: { aliquota: 15, adicional: 10, limiteAdicionalAno: 240000, fonte: 'Lei 9.249/1995, art. 3º' },
    csll: { aliquota: 9, fonte: 'Lei 7.689/1988, art. 3º' },
    presuncao: {
      comercio: { irpj: 8, csll: 12 }, industria: { irpj: 8, csll: 12 }, servicos: { irpj: 32, csll: 32 },
      fonte: 'Lei 9.249/1995, arts. 15 e 20'
    },
    /* Imposto Seletivo 2027. Medida provisória: vale de imediato, mas depende de conversão em lei. Lista conferida em reportagens de 05/11/2026; confirmar no DOU. */
    seletivo: {
      norma: 'MP 1.399/2026, publicada em 04/11/2026', status: 'estimado', vigencia: 'fevereiro a dezembro de 2027',
      itens: [
        ['Cigarros e cigarrilhas', '66,7% sobre 15% do preço + R$ 3,50 por vintena'], ['Demais produtos fumígenos', '37,5%'],
        ['Bebidas açucaradas', '2,6%'], ['Cervejas de malte', '4,2%'], ['Vinhos e outras bebidas fermentadas', '8,0%'],
        ['Vermutes e bebidas semelhantes', '12,0%'], ['Vinhos do Porto e Madeira', '16,0%'], ['Bebidas alcoólicas com teor acima de 14%', '16,0%'],
        ['Bebidas refrescantes com teor alcoólico inferior a 8%', '16,0%'], ['Rum de cana-de-açúcar, exceto melaço', '20,0%'], ['Demais bebidas destiladas', '24,0%'],
        ['Concursos de prognósticos (loterias e apostas)', '0,5%'], ['Aviões e helicópteros', '6,8%'], ['Barcos a motor', '12,0%'],
        ['Demais embarcações de recreio ou esporte a motor', '7,8%'], ['Carros de passeio', 'base de 6,3%, ajustada por critérios do veículo'],
        ['Veículos comerciais leves', 'base de 3,9%, sujeita a ajustes'], ['Bens minerais (petróleo, minério de ferro, carvão, gás natural)', 'zero em 2027']
      ]
    },
    encargosFolha: { valor: 27.8, status: 'cenario', fonte: 'CPP 20% + RAT 2% + terceiros 5,8% (ajuste conforme o cliente)' },
    cppAnexoIV: { valor: 20, fonte: 'LC 123/2006, art. 18, § 5º-C (CPP fora do DAS)' },
    creditoFornecedorSimples: { valor: 3.0, status: 'cenario', fonte: 'Premissa: crédito médio de IBS/CBS em compras de fornecedor do Simples, limitado ao valor pago por ele no regime (LC 214/2025). Ajuste conforme a nota.' },

    // Simples Nacional: LC 123/2006, Anexos I a V (redação da LC 155/2016)
    simples: {
      limite: 4800000,
      faixas: [180000, 360000, 720000, 1800000, 3600000, 4800000],
      fatorR: 28,
      fonte: 'LC 123/2006, Anexos I a V e art. 18, § 5º-J (fator R). De 2027 a 2033: tabelas e partilha dadas pela LC 214/2025 (Anexos XVIII a XXII), conferidas no texto publicado pelo Senado em 23/11/2026',
      /* Parte do ICMS/ISS do DAS que vira IBS em cada ano (LC 214/2025). Em 2027 e 2028 valem as colunas cbs2728 e ibs2728 de cada anexo. */
      ibsFracao: { 2029: 0.1, 2030: 0.2, 2031: 0.3, 2032: 0.4, 2033: 1 },
      /* 5ª faixa de serviços com ISS no teto de 5%: IBS fixo, em % da receita. Em 2033 o texto não traz a linha; o sistema assume 5% (premissa). */
      ibsFixoTeto: { 2029: 0.5, 2030: 1, 2031: 1.5, 2032: 2, 2033: 5 },
      anexos: {
        I: { nome: 'Anexo I — Comércio', aliq: [4, 7.3, 9.5, 10.7, 14.3, 19], pd: [0, 5940, 13860, 22500, 87300, 378000], pisCofins: [15.5, 15.5, 15.5, 15.5, 15.5, 34.4], icmsIss: [34, 34, 33.5, 33.5, 33.5, 0], aliq6: 18.9, cbs2728: [15.33, 15.33, 15.33, 15.33, 15.33, 34.02], ibs2728: [0.17, 0.17, 0.17, 0.17, 0.17, 0] },
        II: { nome: 'Anexo II — Indústria', aliq: [4.5, 7.8, 10, 11.2, 14.7, 30], pd: [0, 5940, 13860, 22500, 85500, 720000], pisCofins: [14, 14, 14, 14, 14, 25.5], icmsIss: [32, 32, 32, 32, 32, 0], aliq6: 29.9, cbs2728: [13.85, 13.85, 13.85, 13.85, 13.85, 25.22], ibs2728: [0.15, 0.15, 0.15, 0.15, 0.15, 0] },
        III: { nome: 'Anexo III — Serviços', aliq: [6, 11.2, 13.5, 16, 21, 33], pd: [0, 9360, 17640, 35640, 125640, 648000], pisCofins: [15.6, 17.1, 16.6, 16.6, 15.6, 19.5], icmsIss: [33.5, 32, 32.5, 32.5, 33.5, 0], aliq6: 32.9, cbs2728: [15.43, 16.91, 16.42, 16.42, 15.43, 19.29], ibs2728: [0.17, 0.19, 0.19, 0.19, 0.17, 0], teto: { limite: 14.92537, cbs2728: 23.20, ibs2728: 0.26, cbs: 23.46 } },
        IV: { nome: 'Anexo IV — Serviços (CPP fora do DAS)', aliq: [4.5, 9, 10.2, 14, 22, 33], pd: [0, 8100, 12420, 39780, 183780, 828000], pisCofins: [21.5, 25, 24, 23, 22, 25], icmsIss: [44.5, 40, 40, 40, 40, 0], aliq6: 32.9, cbs2728: [21.26, 24.73, 23.74, 22.75, 21.76, 24.70], ibs2728: [0.24, 0.27, 0.26, 0.25, 0.24, 0], teto: { limite: 12.5, cbs2728: 36.27, ibs2728: 0.40, cbs: 36.67 } },
        V: { nome: 'Anexo V — Serviços', aliq: [15.5, 18, 19.5, 20.5, 23, 30.5], pd: [0, 4500, 9900, 17100, 62100, 540000], pisCofins: [17.15, 17.15, 18.15, 19.15, 17.15, 20], icmsIss: [14, 17, 19, 21, 23.5, 0], aliq6: 30.4, cbs2728: [16.96, 16.96, 17.95, 18.94, 16.96, 19.78], ibs2728: [0.19, 0.19, 0.20, 0.21, 0.19, 0] }
      }
    }
  };
  root.RTParams = P;
  if (typeof module !== 'undefined') module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
