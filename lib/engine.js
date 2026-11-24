/* Motor de simulação. Funções puras: recebem cliente + parâmetros e devolvem números com memória de cálculo.
   Valores anuais em R$. Percentuais em % (ex.: 11.3). */
(function (root) {
  const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
  const pct = (v, p) => v * p / 100;
  const f = (v, d) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });

  /* Alíquotas de CBS e IBS do ano, conforme cronograma e cenário. */
  function aliquotasAno(ano, P, cenario) {
    const t = P.transicao[ano];
    const total2033 = P.cenarios[cenario || 'base'].total;
    const ibsCheio = total2033 - P.cbsRef.valor;
    if (ano === 2026) return { cbs: P.teste2026.cbs, ibs: P.teste2026.ibs, teste: true, legado: 1, pisCofins: true };
    if (ano === 2027 || ano === 2028)
      return { cbs: r2(P.cbsRef.valor - P.cbsReducaoTeste.valor), ibs: P.ibsTeste.valor, teste: false, legado: t.legado, pisCofins: false };
    return { cbs: P.cbsRef.valor, ibs: r2(ibsCheio * t.ibs), teste: false, legado: t.legado, pisCofins: false };
  }

  /* Alíquota efetiva do Simples: (RBT12 x alíquota - parcela a deduzir) / RBT12 */
  function simplesEfetiva(receita, anexoKey, P, ano) {
    const S = P.simples, A = S.anexos[anexoKey];
    let i = S.faixas.findIndex((f) => receita <= f);
    if (i < 0) i = S.faixas.length - 1;
    /* Em 2027 e 2028 a alíquota nominal da 6ª faixa é um pouco menor (LC 214/2025). */
    const nominal = i === 5 && (ano === 2027 || ano === 2028) ? A.aliq6 : A.aliq[i];
    const efetiva = receita > 0 ? (receita * nominal / 100 - A.pd[i]) / receita * 100 : 0;
    /* Parcela do DAS que é CBS e IBS, em pontos percentuais da receita, pela partilha da lei em cada ano. */
    let cbsPts = 0, ibsPts = 0, teto = false;
    if (ano >= 2027) {
      const a2728 = ano <= 2028;
      if (A.teto && i === 4 && efetiva > A.teto.limite) {
        teto = true;
        cbsPts = (efetiva - 5) * (a2728 ? A.teto.cbs2728 : A.teto.cbs) / 100;
        ibsPts = a2728 ? (efetiva - 5) * A.teto.ibs2728 / 100 : S.ibsFixoTeto[ano];
      } else {
        cbsPts = efetiva * (a2728 ? A.cbs2728[i] : A.pisCofins[i]) / 100;
        ibsPts = efetiva * (a2728 ? A.ibs2728[i] : A.icmsIss[i] * S.ibsFracao[ano]) / 100;
      }
    }
    return { faixa: i + 1, nominal, pd: A.pd[i], efetiva, pisCofins: A.pisCofins[i], icmsIss: A.icmsIss[i], cbsPts, ibsPts, teto };
  }
  function anexoAplicavel(c, P) {
    if (c.anexo !== 'V') return { anexo: c.anexo, fatorR: null };
    const fr = c.receita > 0 ? c.folha / c.receita * 100 : 0;
    return { anexo: fr >= P.simples.fatorR ? 'III' : 'V', fatorR: fr };
  }

  function irpjCsllPresumido(c, P) {
    const pr = P.presuncao[c.atividade];
    const baseIr = pct(c.receita, pr.irpj), baseCs = pct(c.receita, pr.csll);
    const irpj = pct(baseIr, P.irpj.aliquota) + Math.max(0, baseIr - P.irpj.limiteAdicionalAno) * P.irpj.adicional / 100;
    return { irpj, csll: pct(baseCs, P.csll.aliquota), baseIr, baseCs };
  }
  function irpjCsllReal(c, P) {
    const lucro = Math.max(0, pct(c.receita, c.margemReal));
    const irpj = pct(lucro, P.irpj.aliquota) + Math.max(0, lucro - P.irpj.limiteAdicionalAno) * P.irpj.adicional / 100;
    return { irpj, csll: pct(lucro, P.csll.aliquota), lucro };
  }

  /* Premissas que variam por cliente: valor do cadastro; sem cadastro, o padrão dos parâmetros. */
  const encargosFolha = (c, P) => (c.encargosFolha != null ? c.encargosFolha : P.encargosFolha.valor);
  const creditoSimples = (c, P) => (c.creditoSimples != null ? c.creditoSimples : P.creditoFornecedorSimples.valor);

  /* IBS + CBS no regime regular: débito sobre a receita menos crédito das compras. */
  function ibsCbsRegular(c, al, P) {
    const aliq = (al.cbs + al.ibs) * (1 - (c.reducao || 0) / 100);
    const debito = pct(c.baseIbsCbs > 0 ? c.baseIbsCbs : c.receita, aliq); /* base líquida vinda do XML, quando houver */
    const credito = pct(c.comprasRegular, al.cbs + al.ibs) +
      pct(c.comprasSimples, Math.min(creditoSimples(c, P), al.cbs + al.ibs));
    return { aliq, debito, credito, liquido: debito - credito };
  }

  function legadoConsumo(c, al, P, naoCumulativo) {
    const icmsIss = pct(c.receita, c.atividade === 'servicos' ? c.iss : c.icmsLiquido) * al.legado;
    let pisCofins = 0;
    if (al.pisCofins) {
      pisCofins = naoCumulativo
        ? Math.max(0, pct(c.receita - c.comprasRegular - c.comprasSimples, P.pisCofinsNaoCumulativo.valor))
        : pct(c.receita, P.pisCofinsCumulativo.valor);
    }
    return { icmsIss, pisCofins };
  }

  /* Calcula um regime em um ano. Devolve componentes e a memória de cálculo. */
  function calcular(c, regime, ano, P, cenario) {
    const al = aliquotasAno(ano, P, cenario);
    const out = { regime, ano, elegivel: true, itens: {}, memoria: [], passos: [] };
    /* Memória de cálculo passo a passo: título, conta com os números, resultado e base legal. */
    const R = (v) => `R$ ${f(v)}`, pc = (v, d) => `${f(v, d == null ? 2 : d)}%`;
    /* percentual com até 6 casas, sem zeros sobrando, para a conta poder ser refeita na calculadora */
    const px = (v) => { let t = Number(v).toFixed(6).replace(/0+$/, ''); const dec = (t.split('.')[1] || '').length; if (dec < 2) t = Number(v).toFixed(2); return t.replace('.', ',') + '%'; };
    const ps = (t, conta, valor, lei) => out.passos.push({ t, conta, valor: valor == null ? null : r2(valor), lei: lei || '' });
    const bsIva = c.baseIbsCbs > 0 ? c.baseIbsCbs : c.receita, red = c.reducao || 0, aT = al.cbs + al.ibs;
    const passosIva = (rotulo) => {
      const ic = ibsCbsRegular(c, al, P), cs = Math.min(creditoSimples(c, P), aT);
      ps(`${rotulo}: débito das vendas`, `${R(bsIva)} × (CBS ${pc(al.cbs)} + IBS ${pc(al.ibs)})${red ? ` × (1 − ${pc(red)} de redução)` : ''}`, ic.debito, c.baseIbsCbs > 0 ? 'LC 214/2025; base das notas importadas' : 'LC 214/2025');
      if (c.comprasRegular) ps(`${rotulo}: crédito das compras do regime regular`, `${R(c.comprasRegular)} × ${pc(aT)}`, pct(c.comprasRegular, aT), 'LC 214/2025 (não cumulatividade)');
      if (c.comprasSimples) ps(`${rotulo}: crédito das compras do Simples`, `${R(c.comprasSimples)} × ${pc(cs)}`, pct(c.comprasSimples, cs), 'LC 214/2025; percentual do cadastro do cliente');
      ps(`${rotulo}: valor a pagar`, `${R(ic.debito)} − ${R(ic.credito)}${ic.liquido < 0 ? ' (saldo credor)' : ''}`, ic.liquido, '');
    };
    const sobre = c.baseIbsCbs > 0 ? `a base das notas importadas (R$ ${f(c.baseIbsCbs)})` : 'a receita';
    const add = (k, v, memo) => { out.itens[k] = r2(v); if (memo) out.memoria.push(memo); };

    if (regime === 'simples' || regime === 'hibrido') {
      if (c.receita > P.simples.limite) { out.elegivel = false; out.motivo = 'Receita acima do limite de R$ 4,8 milhões do Simples Nacional'; out.total = null; return out; }
      if (regime === 'hibrido' && ano < 2027) { out.elegivel = false; out.motivo = 'A opção pelo regime regular de IBS/CBS dentro do Simples começa em 2027'; out.total = null; return out; }
      const ax = anexoAplicavel(c, P), ef = simplesEfetiva(c.receita, ax.anexo, P, ano);
      const das = pct(c.receita, ef.efetiva);
      out.anexo = ax.anexo; out.fatorR = ax.fatorR; out.simples = ef;
      const tabela = ano >= 2027 ? 'tabela e partilha da LC 214/2025' : 'LC 123/2006';
      const leiS = ano >= 2027 ? 'LC 123/2006, art. 18 e Anexo ' + ax.anexo + ', na redação da LC 214/2025' : 'LC 123/2006, art. 18 e Anexo ' + ax.anexo;
      if (ax.fatorR != null) ps('Fator R', `${R(c.folha)} ÷ ${R(c.receita)} = ${pc(ax.fatorR)} → Anexo ${ax.anexo} (corte em ${pc(P.simples.fatorR, 0)})`, null, 'LC 123/2006, art. 18, § 5º-J');
      ps('Alíquota efetiva do Simples', `(${R(c.receita)} × ${pc(ef.nominal)} − ${R(ef.pd)}) ÷ ${R(c.receita)} = ${px(ef.efetiva)} (${ef.faixa}ª faixa)`, null, leiS);
      if (regime === 'simples') {
        ps('DAS', `${R(c.receita)} × ${px(ef.efetiva)}`, das, leiS);
        if (ano >= 2027) ps('Dentro do DAS: parcela de CBS e de IBS', `CBS ${px(ef.cbsPts)} + IBS ${px(ef.ibsPts)} da receita = ${R(pct(c.receita, ef.cbsPts + ef.ibsPts))} (já incluídos no DAS)`, null, 'Partilha do Anexo ' + ax.anexo + ' para ' + ano);
      } else {
        ps('Parcela de CBS e IBS que sai do DAS', `${ef.teto ? `ISS no teto de 5%: (${px(ef.efetiva)} − 5%) × partilha da lei` : `${px(ef.efetiva)} × ${px(ef.cbsPts / ef.efetiva * 100)} de CBS e × ${px(ef.ibsPts / ef.efetiva * 100)} de IBS`} → CBS ${px(ef.cbsPts)} + IBS ${px(ef.ibsPts)} da receita`, null, 'Partilha do Anexo ' + ax.anexo + ' para ' + ano);
        ps('DAS (sem IBS/CBS)', `${R(c.receita)} × (${px(ef.efetiva)} − ${px(ef.cbsPts)} − ${px(ef.ibsPts)})`, pct(c.receita, ef.efetiva - ef.cbsPts - ef.ibsPts), leiS);
        passosIva('IBS + CBS fora do DAS');
      }
      if (regime === 'simples') {
        add('DAS', das, `DAS: receita x alíquota efetiva de ${f(ef.efetiva)}% (Anexo ${ax.anexo}, faixa ${ef.faixa}, ${tabela})${ano >= 2027 ? `. Dentro dele, CBS de ${f(ef.cbsPts)}% e IBS de ${f(ef.ibsPts)}% da receita` : ''}.`);
      } else {
        add('DAS (sem IBS/CBS)', pct(c.receita, ef.efetiva - ef.cbsPts - ef.ibsPts), `DAS sem a parcela de CBS (${f(ef.cbsPts)}% da receita) e de IBS (${f(ef.ibsPts)}%), que saem do documento único em ${ano} (${tabela}${ef.teto ? ', regra do ISS no teto de 5%' : ''}).`);
        const ic = ibsCbsRegular(c, al, P);
        add('IBS + CBS (regime regular)', ic.liquido, `IBS/CBS fora do DAS: débito de ${f(ic.aliq)}% sobre ${sobre} menos créditos das compras.`);
        out.creditoCliente = r2(ic.debito);
      }
      /* 6ª faixa (acima de R$ 3,6 milhões): ICMS, ISS e IBS não estão no DAS e são pagos por fora. */
      if (ef.faixa === 6) {
        const lg = legadoConsumo(c, al, P, false), nomeLg = c.atividade === 'servicos' ? 'ISS' : 'ICMS';
        if (al.legado > 0) ps(`${nomeLg} (fora do DAS, 6ª faixa)`, `${R(c.receita)} × ${pc(c.atividade === 'servicos' ? c.iss : c.icmsLiquido)} × ${pc(al.legado * 100, 0)} da alíquota em ${ano}`, lg.icmsIss, 'LC 123/2006 (sublimite); EC 132/2023 (transição)');
        if (al.legado > 0) add(`${nomeLg} (fora do DAS, 6ª faixa)`, lg.icmsIss, `${nomeLg} pago fora do DAS na 6ª faixa, a ${Math.round(al.legado * 100)}% da alíquota atual em ${ano}.`);
        if (regime === 'simples' && ano >= 2027) {
          const bs = c.baseIbsCbs > 0 ? c.baseIbsCbs : c.receita, ibsFora = Math.max(0, pct(bs, al.ibs * (1 - (c.reducao || 0) / 100)) - pct(c.comprasRegular, al.ibs));
          ps('IBS (fora do DAS, 6ª faixa)', `${R(bs)} × ${pc(al.ibs)}${red ? ` × (1 − ${pc(red)})` : ''} − ${R(c.comprasRegular)} × ${pc(al.ibs)}`, ibsFora, 'Premissa de simulação');
          add('IBS (fora do DAS, 6ª faixa)', ibsFora, `IBS pago fora do DAS na 6ª faixa: ${f(al.ibs)}% sobre as vendas menos o IBS das compras (premissa de simulação).`);
        }
      }
      if (ax.anexo === 'IV') ps('CPP (fora do DAS)', `${R(c.folha)} × ${pc(P.cppAnexoIV.valor, 0)}`, pct(c.folha, P.cppAnexoIV.valor), 'LC 123/2006, Anexo IV');
      if (ax.anexo === 'IV') add('CPP (fora do DAS)', pct(c.folha, P.cppAnexoIV.valor), `CPP de ${P.cppAnexoIV.valor}% sobre a folha, paga fora do DAS no Anexo IV.`);
    } else {
      const real = regime === 'real';
      const ic = ibsCbsRegular(c, al, P);
      if (al.teste) {
        out.destaque2026 = r2(pct(c.receita, al.cbs + al.ibs));
        ps('CBS e IBS de teste, só destacados na nota', `${R(c.receita)} × (${pc(al.cbs)} + ${pc(al.ibs)}) = ${R(pct(c.receita, aT))}, sem aumento de carga`, null, 'LC 214/2025 (ano-teste de 2026)');
        out.memoria.push(`2026 é ano-teste: CBS ${al.cbs}% e IBS ${al.ibs}% são destacados na nota, sem aumento de carga.`);
      } else {
        passosIva('IBS + CBS');
        add('IBS + CBS', ic.liquido, `IBS/CBS: débito de ${f(ic.aliq)}% sobre ${sobre} (CBS ${f(al.cbs)}% + IBS ${f(al.ibs)}%${c.reducao ? `, com redução de ${c.reducao}%` : ''}) menos créditos das compras.`);
        out.creditoCliente = r2(ic.debito);
      }
      const lg = legadoConsumo(c, al, P, real);
      if (al.pisCofins) add('PIS/Cofins', lg.pisCofins, real ? `PIS/Cofins não cumulativo de ${f(P.pisCofinsNaoCumulativo.valor)}% sobre receita menos compras.` : `PIS/Cofins cumulativo de ${f(P.pisCofinsCumulativo.valor)}% sobre a receita.`);
      if (al.legado > 0) add(c.atividade === 'servicos' ? 'ISS' : 'ICMS', lg.icmsIss, `${c.atividade === 'servicos' ? 'ISS' : 'ICMS'} a ${Math.round(al.legado * 100)}% da alíquota atual em ${ano}.`);
      if (al.pisCofins) ps('PIS/Cofins', real ? `(${R(c.receita)} − ${R(c.comprasRegular + c.comprasSimples)} de compras) × ${pc(P.pisCofinsNaoCumulativo.valor)}` : `${R(c.receita)} × ${pc(P.pisCofinsCumulativo.valor)}`, lg.pisCofins, real ? 'Leis 10.637/2002 e 10.833/2003 (não cumulativo)' : 'Lei 9.718/1998 (cumulativo)');
      if (al.legado > 0) ps(c.atividade === 'servicos' ? 'ISS' : 'ICMS', `${R(c.receita)} × ${pc(c.atividade === 'servicos' ? c.iss : c.icmsLiquido)} do cadastro × ${pc(al.legado * 100, 0)} da alíquota em ${ano}`, lg.icmsIss, 'EC 132/2023 (transição)');
      const ir = real ? irpjCsllReal(c, P) : irpjCsllPresumido(c, P);
      const bIr = real ? ir.lucro : ir.baseIr, bCs = real ? ir.lucro : ir.baseCs, adic = Math.max(0, bIr - P.irpj.limiteAdicionalAno);
      ps(real ? 'Lucro tributável' : 'Base presumida do IRPJ', real ? `${R(c.receita)} × ${pc(c.margemReal)} de margem informada` : `${R(c.receita)} × ${pc(P.presuncao[c.atividade].irpj, 0)}`, bIr, real ? 'Dado do cadastro do cliente' : 'Lei 9.249/1995, art. 15');
      ps('IRPJ', `${R(bIr)} × ${pc(P.irpj.aliquota, 0)}${adic > 0 ? ` + (${R(bIr)} − ${R(P.irpj.limiteAdicionalAno)}) × ${pc(P.irpj.adicional, 0)} de adicional` : ''}`, ir.irpj, 'Lei 9.249/1995, art. 3º');
      ps('CSLL', real ? `${R(bCs)} × ${pc(P.csll.aliquota, 0)}` : `${R(c.receita)} × ${pc(P.presuncao[c.atividade].csll, 0)} = ${R(bCs)} de base; × ${pc(P.csll.aliquota, 0)}`, ir.csll, real ? 'Lei 7.689/1988' : 'Lei 9.249/1995, art. 20; Lei 7.689/1988');
      ps('Encargos sobre a folha', `${R(c.folha)} × ${pc(encargosFolha(c, P), 1)}`, pct(c.folha, encargosFolha(c, P)), 'Percentual do cadastro do cliente');
      add('IRPJ', ir.irpj, real ? `IRPJ sobre lucro tributável de ${c.margemReal}% da receita.` : `IRPJ sobre base presumida de ${P.presuncao[c.atividade].irpj}% da receita.`);
      add('CSLL', ir.csll);
      add('Encargos sobre a folha', pct(c.folha, encargosFolha(c, P)), `Encargos patronais de ${f(encargosFolha(c, P),1)}% sobre a folha.`);
    }
    out.total = r2(Object.values(out.itens).reduce((a, b) => a + b, 0));
    out.passos.forEach((q) => { q.soma = q.valor != null && (q.t in out.itens || /valor a pagar$/.test(q.t)); });
    ps('Total do regime no ano', Object.values(out.itens).map((v) => R(v)).join(' + '), out.total, '');
    out.passos[out.passos.length - 1].total = true;
    out.pctReceita = c.receita > 0 ? out.total / c.receita * 100 : 0;
    return out;
  }

  const REGIMES = [
    { id: 'simples', nome: 'Simples Nacional' },
    { id: 'hibrido', nome: 'Simples híbrido' },
    { id: 'presumido', nome: 'Lucro Presumido' },
    { id: 'real', nome: 'Lucro Real' }
  ];

  /* Simulação completa 2026-2033 em todos os regimes. */
  function simular(c, P, cenario) {
    const anos = P.anos.map((ano) => {
      const res = {};
      REGIMES.forEach((r) => { res[r.id] = calcular(c, r.id, ano, P, cenario); });
      const ok = REGIMES.filter((r) => res[r.id].elegivel).sort((a, b) => res[a.id].total - res[b.id].total);
      return { ano, aliquotas: aliquotasAno(ano, P, cenario), res, melhor: ok.length ? ok[0].id : null };
    });
    const viradas = [];
    for (let i = 1; i < anos.length; i++) if (anos[i].melhor !== anos[i - 1].melhor) viradas.push({ ano: anos[i].ano, de: anos[i - 1].melhor, para: anos[i].melhor });
    const acumulado = {};
    REGIMES.forEach((r) => {
      const todos = anos.every((a) => a.res[r.id].elegivel || (r.id === 'hibrido' && a.ano < 2027));
      acumulado[r.id] = todos ? r2(anos.reduce((s, a) => s + (a.res[r.id].total != null ? a.res[r.id].total : a.res.simples.total || 0), 0)) : null;
    });
    return { cliente: c, cenario: cenario || 'base', anos, viradas, acumulado, regimes: REGIMES };
  }

  /* Cálculo por operação (espelho do cálculo oficial por item de nota). */
  /* Arredondamento da calculadora oficial: precisão interna de 8 casas e moeda com 2 casas, modo HALF_EVEN (bancário). */
  function he2(v) {
    const x = Number((Number(v.toFixed(8)) * 100).toFixed(6)), fl = Math.floor(x), d = x - fl;
    const n = Math.abs(d - 0.5) < 1e-6 ? (fl % 2 === 0 ? fl : fl + 1) : Math.round(x);
    return n / 100;
  }

  /* Tratamento oficial de cada classificação (campo t da tabela extraída da calculadora da Receita). */
  const TRAT = {
    zero: 'Sem imposto a pagar nesta operação',
    mono: 'Tributação monofásica: o imposto é calculado por quantidade, não pelo valor',
    dif: 'Diferimento: o imposto é calculado, mas o pagamento fica adiado',
    off: 'Classificação sem tratamento ativo na calculadora oficial',
    base50: 'Base de cálculo reduzida em 50%',
    fixa: 'Alíquota própria do regime'
  };
  const semImposto = (t) => t === 'zero' || t === 'mono' || t === 'dif' || t === 'off';
  /* Redução equivalente de uma classificação, para a simulação anual. */
  function reducaoClasse(cc) {
    if (!cc) return 0;
    if (semImposto(cc.t)) return 100;
    return cc.t === 'base50' ? 100 - 0.5 * (100 - (cc.r || 0)) : (cc.r || 0);
  }
  /* IBS do ano dividido entre estado e município, como a nota exige. A partir de 2029 a divisão ainda não foi fixada. */
  function ibsPartes(ano, ibs) {
    if (ano === 2026) return [ibs, 0];
    if (ano <= 2028) return [ibs / 2, ibs / 2];
    return [ibs, 0];
  }
  /* Imposto de um item, pela mesma regra da calculadora oficial: base x alíquota x (1 - redução), arredondado por tributo. */
  function tributoItem(base, cc, aliq) {
    cc = cc || {};
    if (semImposto(cc.t)) return { base, cbs: 0, ibsUF: 0, ibsMun: 0, ibs: 0, trat: TRAT[cc.t] };
    const b = cc.t === 'base50' ? base * 0.5 : base, r = (cc.r || 0) / 100, ri = (cc.ri == null ? (cc.r || 0) : cc.ri) / 100;
    const cbs = he2(b * aliq.cbs * (1 - r) / 100), ibsUF = he2(b * aliq.ibsUF * (1 - ri) / 100), ibsMun = he2(b * aliq.ibsMun * (1 - ri) / 100);
    return { base: b, cbs, ibsUF, ibsMun, ibs: he2(ibsUF + ibsMun), trat: TRAT[cc.t] || '' };
  }

  function operacao(item, ano, P, cenario) {
    const al = aliquotasAno(ano, P, cenario), pt = ibsPartes(ano, al.ibs);
    const base = item.base || 0, cc = item.cc || { r: item.reducao || 0, ri: item.reducao || 0 };
    const t = tributoItem(base, cc, { cbs: al.cbs, ibsUF: pt[0], ibsMun: pt[1] });
    const red = reducaoClasse(cc);
    return {
      ano, base, reducao: red, aliqCbs: al.cbs, aliqIbs: al.ibs, cbs: t.cbs, ibs: t.ibs, ibsUF: t.ibsUF, ibsMun: t.ibsMun, tratamento: t.trat,
      total: he2(t.cbs + t.ibs), totalNota: he2(base + t.cbs + t.ibs),
      memoria: `Base de cálculo de R$ ${f(base)}. CBS de ${f(al.cbs)}% e IBS de ${f(al.ibs)}%${t.trat ? `. ${t.trat}` : red ? `, com redução de ${f(red, 0)}%` : ''}. Tributos cobrados por fora do preço.`
    };
  }

  const E = { aliquotasAno, simplesEfetiva, anexoAplicavel, calcular, simular, operacao, tributoItem, reducaoClasse, ibsPartes, he2, TRAT, encargosFolha, creditoSimples, REGIMES, r2 };
  root.RTEngine = E;
  if (typeof module !== 'undefined') module.exports = E;
})(typeof window !== 'undefined' ? window : globalThis);
